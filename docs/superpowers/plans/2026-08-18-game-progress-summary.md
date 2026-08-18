# Game Progress Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right-sidebar “当前进度” placeholder with a safe cumulative AI summary that updates every 10 judged normal questions, refreshes after relevant Challenge verdict changes, and reconciles an already-running ACTIVE game at Worker startup (for example 41 judged questions → ensure boundary 40).

**Architecture:** Add a public current-summary state table plus a private progress-summary job queue. A new `progress-summary` AI skill receives only public question text + current public verdict. All scheduling paths share one idempotent boundary helper keyed by `(game, boundary, source fingerprint)`, so normal boundaries, Challenge refreshes, startup backfill, retries, and concurrent Worker starts cannot publish duplicate/stale work. Summary work remains outside the ordered `private.game_actions` queue.

**Tech Stack:** TypeScript 7/6, Vitest 4, Node `crypto`, PostgreSQL/Supabase + pgTAP, existing Harness/OpenAI Responses runtimes, Next.js 16.3.1, React 19.2.8.

**Spec:** `docs/superpowers/specs/2026-08-18-game-progress-summary-design.md`

**Code baseline:** `88382241598da3c6a3d452f6586eac4b03b3bf9a`

**Updated spec commit:** `9c779a0d0e4d0983e437c91d46487b93a8b559b8`

## Global Constraints

- Do not change verdict semantics, scoring, key-point extraction, cumulative Evidence, final-answer behavior, or challenge voting rules.
- Cadence uses only `api.messages.status = 'JUDGED'`; never use submitted-question count alone.
- The summarizer must never receive full solution, private key points, private Evidence, claims, awards, or scores.
- V1 emits player-facing facts only from YES, NO, and IRRELEVANT. BOTH never creates a summary fact.
- Do not add `PROGRESS_SUMMARY` to `private.game_actions.action_type`.
- Keep the last successful facts visible while a newer target is PENDING or ERROR.
- Startup reconciliation applies only to the current ACTIVE game and only the latest eligible 10-question boundary.
- Restart must not bypass the four-attempt retry ceiling for an unchanged BLOCKED source.
- Same-boundary public verdict changes must produce a different deterministic source fingerprint.
- Never publish model output if the fixed source fingerprint changed before completion.
- Browser roles never receive access to private summary jobs or judge-attempt internals.
- Before changing Next.js code, read the relevant local docs under `apps/web/node_modules/next/dist/docs/` as required by `apps/web/AGENTS.md`.
- No unrelated refactors or dashboard redesign.

---

## File map

### Create

- `services/judge-worker/src/skills/progress-summary.ts`
- `services/judge-worker/src/skills/progress-summary.test.ts`
- `services/judge-worker/src/processors/progress-summary-processor.ts`
- `services/judge-worker/src/processors/progress-summary-processor.test.ts`
- `services/judge-worker/src/db/progress-summary-queue.ts`
- `services/judge-worker/src/db/progress-summary-queue.test.ts`
- `services/judge-worker/src/db/complete-progress-summary.ts`
- `services/judge-worker/src/db/complete-progress-summary.test.ts`
- `apps/web/src/components/game/progress-summary-panel.tsx`
- `apps/web/src/components/game/progress-summary-panel.test.tsx`
- `supabase/migrations/20260818173000_game_progress_summary.sql`
- `supabase/tests/database/008_game_progress_summary.test.sql`

### Modify

- `packages/contracts/src/game.ts`
- `packages/contracts/src/judge.ts`
- `packages/contracts/src/contracts.test.ts`
- `services/judge-worker/src/skills/validate-result.ts`
- `services/judge-worker/src/skills/validate-result.test.ts`
- `services/judge-worker/src/runtime/semantic-judge.ts`
- `services/judge-worker/src/runtime/harness-semantic-judge.ts`
- `services/judge-worker/src/runtime/openai-responses-semantic-judge.ts`
- `services/judge-worker/src/runtime/create-semantic-judge.ts`
- `services/judge-worker/src/runtime/audited-semantic-judge.ts`
- `services/judge-worker/src/db/judge-attempts.ts`
- `services/judge-worker/src/config.ts`
- `services/judge-worker/src/config.test.ts`
- `services/judge-worker/src/worker.ts`
- `services/judge-worker/src/worker.test.ts`
- `services/judge-worker/src/main.ts`
- `services/judge-worker/src/main.test.ts`
- `services/judge-worker/src/db/complete-question.ts`
- `services/judge-worker/src/db/complete-question.test.ts`
- `services/judge-worker/src/db/complete-challenge.ts`
- `services/judge-worker/src/db/complete-challenge.test.ts`
- `apps/web/src/server/game/get-current-snapshot.ts`
- `apps/web/src/server/game/get-current-snapshot.test.ts`
- `apps/web/src/lib/supabase-browser.ts`
- `apps/web/src/components/game/game-client.tsx`
- `apps/web/src/components/game/game-client.integration.test.tsx`
- `apps/web/src/app/globals.css`
- `.env.example`
- `scripts/local-acceptance.mjs`
- `services/judge-worker/src/index.ts` only if required by the repository’s current export pattern.

---

## Task 1: Lock public/AI contracts, validator, and prompt semantics

**Files:**
- Modify: `packages/contracts/src/game.ts`
- Modify: `packages/contracts/src/judge.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Modify: `services/judge-worker/src/skills/validate-result.ts`
- Modify: `services/judge-worker/src/skills/validate-result.test.ts`
- Create: `services/judge-worker/src/skills/progress-summary.ts`
- Create: `services/judge-worker/src/skills/progress-summary.test.ts`

**Produces:**

```ts
export type ProgressSummaryGenerationStatus = 'PENDING' | 'READY' | 'ERROR';

export type PublicGameProgressSummary = {
  gameId: string;
  throughQuestionCount: number;
  throughSequenceNo: number;
  confirmedFacts: string[];
  ruledOutFacts: string[];
  irrelevantTopics: string[];
  generationStatus: ProgressSummaryGenerationStatus;
  targetQuestionCount: number | null;
  generatedAt: Timestamp | null;
  updatedAt: Timestamp;
};

export type ProgressSummarySourceItem = {
  sequence_no: number;
  question: string;
  verdict: JudgeVerdict;
};

export type ProgressSummaryInput = {
  questions: ProgressSummarySourceItem[];
};

export type ProgressSummaryResult = {
  confirmed_facts: string[];
  ruled_out_facts: string[];
  irrelevant_topics: string[];
};
```

`PublicGameSnapshot` gains:

```ts
progressSummary: PublicGameProgressSummary | null;
```

`SemanticJudge` gains:

```ts
summarizeProgress(input: ProgressSummaryInput): Promise<ProgressSummaryResult>;
```

- [ ] **Step 1: Write RED validator/contract tests**

Accept three arrays; reject extra properties, >4 items/category, empty strings, >120-char strings, and NFKC/lowercase exact duplicates in one category.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @turtle-soup/contracts test
pnpm --filter @turtle-soup/judge-worker test -- validate-result progress-summary
```

- [ ] **Step 3: Implement contracts and `PROGRESS_SUMMARY_SCHEMA`**

Use the same strict AJV path as existing skills.

- [ ] **Step 4: Implement prompt**

Export:

```ts
export const PROGRESS_SUMMARY_PROMPT_VERSION = 'progress-summary-v1';
export function buildProgressSummaryPrompt(input: ProgressSummaryInput): string;
```

Prompt requirements:

- supplied public question/verdict rows are the only evidence;
- YES → confirmed proposition;
- NO → ruled-out proposition;
- IRRELEVANT → only broad unrelated direction;
- BOTH → no output fact;
- correctly handle grammatical negation;
- merge repeated/overlapping discoveries;
- never invent missing causal/identity/motive/chronology facts;
- no verdict-token wording in player-facing strings;
- exactly the three schema fields.

The input contract must make it impossible to pass solution/KP/Evidence/score fields without an explicit later redesign.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --filter @turtle-soup/contracts test
pnpm --filter @turtle-soup/contracts typecheck
pnpm --filter @turtle-soup/judge-worker test -- validate-result progress-summary
pnpm --filter @turtle-soup/judge-worker typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src services/judge-worker/src/skills
git commit -m "feat: define progress summary contracts"
```

---

## Task 2: Wire `progress-summary` through Harness/OpenAI config and auditing

**Files:**
- Modify: `services/judge-worker/src/runtime/semantic-judge.ts`
- Modify: `services/judge-worker/src/runtime/harness-semantic-judge.ts`
- Modify: `services/judge-worker/src/runtime/openai-responses-semantic-judge.ts`
- Modify: `services/judge-worker/src/runtime/create-semantic-judge.ts`
- Modify: `services/judge-worker/src/runtime/audited-semantic-judge.ts`
- Modify: `services/judge-worker/src/db/judge-attempts.ts`
- Modify: `services/judge-worker/src/config.ts`
- Modify: `services/judge-worker/src/config.test.ts`
- Modify: `.env.example`

**Interfaces:**

```ts
export type HarnessSkill =
  | 'key-point-extraction'
  | 'question-judge'
  | 'final-answer-judge'
  | 'progress-summary';
```

```ts
export type JudgeAttemptParent =
  | { actionId: string; extractionJobId?: never; progressSummaryJobId?: never; attemptNo: number }
  | { extractionJobId: string; actionId?: never; progressSummaryJobId?: never; attemptNo: number }
  | { progressSummaryJobId: string; actionId?: never; extractionJobId?: never; attemptNo: number };
```

- [ ] **Step 1: RED tests** for fourth-skill creation, default config, per-skill overrides, Harness invocation, OpenAI Responses schema path, and audited parent.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @turtle-soup/judge-worker test -- config runtime audited-semantic-judge
```

- [ ] **Step 3: Implement runtime routing**

Add `progress-summary` to `SKILLS`, `PROMPT_VERSIONS`, config map, both provider implementations, and the returned composite judge.

- [ ] **Step 4: Add optional env overrides**

```text
JUDGE_PROGRESS_SUMMARY_MODEL=
JUDGE_PROGRESS_SUMMARY_REASONING_EFFORT=off
```

Fallback remains `JUDGE_MODEL` + `off`.

- [ ] **Step 5: Extend audit plumbing** so `recordJudgeAttempt()` can write `progress_summary_job_id`. Auditing remains best-effort.

- [ ] **Step 6: GREEN**

```bash
pnpm --filter @turtle-soup/judge-worker test
pnpm --filter @turtle-soup/judge-worker typecheck
```

- [ ] **Step 7: Commit**

```bash
git add .env.example services/judge-worker/src/runtime services/judge-worker/src/db/judge-attempts.ts services/judge-worker/src/config.ts services/judge-worker/src/config.test.ts
git commit -m "feat: add progress summary judge skill"
```

---

## Task 3: Add public summary state, private jobs, fingerprint uniqueness, RLS, Realtime, and audit FK

**Files:**
- Create: `supabase/migrations/20260818173000_game_progress_summary.sql`
- Create: `supabase/tests/database/008_game_progress_summary.test.sql`

**Database contract:**

`api.game_progress_summaries`:

```text
game_id uuid PK
through_question_count integer default 0
through_sequence_no bigint default 0
source_fingerprint text null
confirmed_facts text[] default '{}'
ruled_out_facts text[] default '{}'
irrelevant_topics text[] default '{}'
generation_status PENDING|READY|ERROR
target_question_count integer null
target_sequence_no bigint null
target_source_fingerprint text null
generated_at timestamptz null
updated_at timestamptz
```

`private.progress_summary_jobs`:

```text
id uuid PK
game_id uuid FK
through_question_count integer
through_sequence_no bigint
source_fingerprint text
status PENDING|PROCESSING|RETRY|BLOCKED|COMPLETED|STALE|CANCELLED
attempt_count integer
next_attempt_at timestamptz
lease_owner text null
lease_expires_at timestamptz null
error_code text null
created_at timestamptz
updated_at timestamptz
UNIQUE (game_id, through_question_count, source_fingerprint)
```

- [ ] **Step 1: Write RED pgTAP** covering tables/columns/checks/FKs, exact all-status uniqueness, browser denial on private jobs, public SELECT-only summary state, Worker queue privileges, forced RLS, and Realtime publication membership.

Also test `private.judge_attempts.progress_summary_job_id` and exactly-one-parent constraint.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec supabase db reset
```

Expected pgTAP/schema assertions fail before migration exists.

- [ ] **Step 3: Implement migration** following the existing narrow permission style in `20260814170905_narrow_runtime_permissions.sql` and later challenge/evidence migrations. Do not broaden game_web/private access.

- [ ] **Step 4: Verify GREEN**

```bash
pnpm exec supabase db reset
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260818173000_game_progress_summary.sql supabase/tests/database/008_game_progress_summary.test.sql
git commit -m "feat: add progress summary persistence"
```

---

## Task 4: Implement canonical source/fingerprint and the shared idempotent scheduler

**Files:**
- Create: `services/judge-worker/src/db/progress-summary-queue.ts`
- Create: `services/judge-worker/src/db/progress-summary-queue.test.ts`
- Reuse: `services/judge-worker/src/db/queue.ts` retry constants where appropriate.

**Produces:**

```ts
export type ProgressSummaryBoundary = {
  throughQuestionCount: number;
  throughSequenceNo: number;
  sourceFingerprint: string;
  questions: ProgressSummarySourceItem[];
};

export async function loadProgressSummaryBoundary(
  sql: Sql,
  gameId: string,
  throughQuestionCount: number,
): Promise<ProgressSummaryBoundary>;

export function fingerprintProgressSummarySource(
  questions: readonly ProgressSummarySourceItem[],
): string;

export async function ensureProgressSummaryJobForBoundary(
  sql: Sql,
  gameId: string,
  throughQuestionCount: number,
): Promise<void>;

export async function reconcileActiveGameProgressSummary(sql: Sql): Promise<void>;
```

Fingerprint implementation:

```ts
createHash('sha256')
  .update(JSON.stringify(questions.map(({ sequence_no, question, verdict }) => [sequence_no, question, verdict])))
  .digest('hex');
```

- [ ] **Step 1: RED pure fingerprint tests**

Assert deterministic 64-char lowercase hex; changed verdict/question/order changes fingerprint.

- [ ] **Step 2: RED scheduler tests**

Cover:

- invalid boundary (<10 or not divisible by 10) rejected/no-op according to chosen internal API;
- exactly first N JUDGED messages loaded in sequence order;
- PENDING messages excluded;
- Nth judged message determines `throughSequenceNo` even if game-action sequence numbers have gaps from final answers/challenges;
- READY matching boundary+fingerprint → no job;
- existing job with same all-status unique key (PENDING/PROCESSING/RETRY/BLOCKED/COMPLETED/STALE) → no duplicate;
- changed same-boundary verdict → new fingerprint → new job;
- enqueue preserves older successful arrays and sets target metadata/PENDING.

- [ ] **Step 3: RED startup reconciliation tests**

Required exact cases:

```text
0 judged  -> no-op
9 judged  -> no-op
10 judged -> ensure 10
19 judged -> ensure 10
20 judged -> ensure 20
41 judged -> ensure 40
```

Also:

- READY matching 40 + 41 judged → no-op;
- READY 30 + 41 judged → ensure 40;
- existing PENDING/PROCESSING/RETRY 40 source → no duplicate;
- existing BLOCKED 40 same fingerprint → no new attempt;
- two concurrent reconcile calls → exactly one DB job due to unique key;
- no ACTIVE game → no-op;
- ENDED-only database → no backfill.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @turtle-soup/judge-worker test -- progress-summary-queue
```

- [ ] **Step 5: Implement source/fingerprint/scheduler/reconciliation**

Use current public `api.messages.verdict`, not private original judgment values.

- [ ] **Step 6: GREEN**

```bash
pnpm --filter @turtle-soup/judge-worker test -- progress-summary-queue
pnpm --filter @turtle-soup/judge-worker typecheck
```

- [ ] **Step 7: Commit**

```bash
git add services/judge-worker/src/db/progress-summary-queue.ts services/judge-worker/src/db/progress-summary-queue.test.ts
git commit -m "feat: schedule progress summaries"
```

---

## Task 5: Trigger scheduling from completed questions and resolved Challenges

**Files:**
- Modify: `services/judge-worker/src/db/complete-question.ts`
- Modify: `services/judge-worker/src/db/complete-question.test.ts`
- Modify: `services/judge-worker/src/db/complete-challenge.ts`
- Modify: `services/judge-worker/src/db/complete-challenge.test.ts`

- [ ] **Step 1: RED question cadence tests**

Cover judged counts 9/10/11/19/20. Only 10 and 20 call `ensureProgressSummaryJobForBoundary()`.

Both legacy and Evidence question completion paths must behave identically for summary scheduling.

- [ ] **Step 2: RED Challenge tests**

Cover:

- verdict unchanged after resolution → no summary scheduling;
- question 7 changed when latest eligible boundary is 10 → ensure boundary 10;
- question 14 changed when eligible boundary is 10 → no refresh;
- question 17 changed when 23 judged → ensure boundary 20;
- same-boundary changed verdict produces a different fingerprint/job through shared helper;
- scoring/rebuild behavior remains unchanged.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @turtle-soup/judge-worker test -- complete-question complete-challenge
```

- [ ] **Step 4: Implement minimal calls to shared helper** inside existing completion transactions after public current judgment state is correct. Do not duplicate fingerprint logic in these files.

- [ ] **Step 5: GREEN**

```bash
pnpm --filter @turtle-soup/judge-worker test -- complete-question complete-challenge
pnpm --filter @turtle-soup/judge-worker typecheck
```

- [ ] **Step 6: Commit**

```bash
git add services/judge-worker/src/db/complete-question* services/judge-worker/src/db/complete-challenge*
git commit -m "feat: trigger progress summary updates"
```

---

## Task 6: Implement summary claiming, stale-safe processing, completion, retry, and blocking

**Files:**
- Modify: `services/judge-worker/src/db/progress-summary-queue.ts`
- Modify: `services/judge-worker/src/db/progress-summary-queue.test.ts`
- Create: `services/judge-worker/src/processors/progress-summary-processor.ts`
- Create: `services/judge-worker/src/processors/progress-summary-processor.test.ts`
- Create: `services/judge-worker/src/db/complete-progress-summary.ts`
- Create: `services/judge-worker/src/db/complete-progress-summary.test.ts`

**Additional interfaces:**

```ts
export type ClaimedProgressSummaryJob = {
  id: string;
  gameId: string;
  throughQuestionCount: number;
  throughSequenceNo: number;
  sourceFingerprint: string;
  attempt: number;
  leaseOwner: string;
  leaseExpiresAt: string;
};

export async function claimNextProgressSummary(...): Promise<ClaimedProgressSummaryJob | null>;
export async function recordProgressSummaryRetry(...): Promise<void>;
export async function markProgressSummaryBlocked(...): Promise<void>;
```

- [ ] **Step 1: RED claim/retry tests** using existing lease/retry semantics (2,5,15 seconds, then BLOCKED).

- [ ] **Step 2: RED processor tests**

Assert model input is exactly public source rows and contains no solution/KP/Evidence/score properties.

Before invoking model, recompute job boundary fingerprint. If it differs, mark STALE + ensure replacement; model must not be called.

- [ ] **Step 3: RED completion race tests**

Cover:

- active lease + unchanged fingerprint → publish result + COMPLETED + READY;
- lease lost → no publication;
- source changes after model call but before completion → STALE, no stale publication, ensure replacement;
- previous READY arrays survive while new job pending;
- blocked newest target → ERROR preserving old arrays;
- blocked obsolete target must not overwrite a newer PENDING/READY target;
- exact-once completion replay → no score/message/game changes and no duplicate state.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @turtle-soup/judge-worker test -- progress-summary-processor complete-progress-summary progress-summary-queue
```

- [ ] **Step 5: Implement minimal processor/completion**

AI call stays outside DB transaction. Completion transaction revalidates lease + source fingerprint.

- [ ] **Step 6: GREEN**

```bash
pnpm --filter @turtle-soup/judge-worker test -- progress-summary
pnpm --filter @turtle-soup/judge-worker typecheck
pnpm exec supabase db reset
```

- [ ] **Step 7: Commit**

```bash
git add services/judge-worker/src/db/progress-summary-queue* services/judge-worker/src/db/complete-progress-summary* services/judge-worker/src/processors/progress-summary-processor*
git commit -m "feat: process progress summary jobs"
```

---

## Task 7: Wire startup reconciliation and the summary queue into the Worker lifecycle

**Files:**
- Modify: `services/judge-worker/src/worker.ts`
- Modify: `services/judge-worker/src/worker.test.ts`
- Modify: `services/judge-worker/src/main.ts`
- Modify: `services/judge-worker/src/main.test.ts`
- Modify: `services/judge-worker/src/index.ts` only if exports require it.

**Required startup order:**

```text
heartbeat()
→ startupReconcile()
→ normal loop
```

Extend `WorkerLoopOptions` with optional explicit dependencies rather than hard-coding DB work:

```ts
startupReconcile?: () => Promise<void>;
claimProgressSummary?: () => Promise<ClaimedProgressSummaryJob | null>;
processProgressSummary?: (job: ClaimedProgressSummaryJob) => Promise<void>;
```

- [ ] **Step 1: RED Worker lifecycle tests**

Assert:

- first heartbeat happens before `startupReconcile`;
- reconciliation happens exactly once per `runWorker()` start, not every idle iteration;
- reconciliation happens before first extraction/action/summary claim;
- missing callback is a safe no-op for tests/legacy injection;
- summary jobs can be claimed/processed without changing `ClaimedAction.actionType` union;
- abort/finally heartbeat timer behavior remains unchanged.

- [ ] **Step 2: RED `main.ts` wiring tests**

Assert default startup reconcile calls `reconcileActiveGameProgressSummary(getWorkerDb())` (or equivalent injected DB path), and summary AI attempts use `{ progressSummaryJobId, attemptNo }` audit parent.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @turtle-soup/judge-worker test -- worker main
```

- [ ] **Step 4: Implement startup hook**

`runWorker()` order must be:

```ts
await options.heartbeat();
await options.startupReconcile?.();
// then enter while loop
```

Do not put reconciliation in the heartbeat interval.

- [ ] **Step 5: Wire summary queue**

Keep summary queue distinct from `claimNextAction()`. Preserve the existing strict sequence semantics for NORMAL_MESSAGE / FINAL_ANSWER / CHALLENGE.

Recommended V1 loop order after startup:

```text
claim extraction
→ claim game action
→ claim progress summary
→ idle
```

This keeps game judgments higher priority. If the existing tests/architecture make a different non-blocking order safer, retain game-action ordering as the hard invariant and document the minimal deviation.

- [ ] **Step 6: GREEN**

```bash
pnpm --filter @turtle-soup/judge-worker test
pnpm --filter @turtle-soup/judge-worker typecheck
pnpm --filter @turtle-soup/judge-worker build
```

- [ ] **Step 7: Commit**

```bash
git add services/judge-worker/src/worker* services/judge-worker/src/main* services/judge-worker/src/index.ts
git commit -m "feat: reconcile progress summaries on worker startup"
```

---

## Task 8: Expose summary state in snapshot/Realtime and replace the right-sidebar placeholder

**Files:**
- Modify: `apps/web/src/server/game/get-current-snapshot.ts`
- Modify: `apps/web/src/server/game/get-current-snapshot.test.ts`
- Modify: `apps/web/src/lib/supabase-browser.ts`
- Create: `apps/web/src/components/game/progress-summary-panel.tsx`
- Create: `apps/web/src/components/game/progress-summary-panel.test.tsx`
- Modify: `apps/web/src/components/game/game-client.tsx`
- Modify: `apps/web/src/components/game/game-client.integration.test.tsx`
- Modify: `apps/web/src/app/globals.css`

Before editing, read relevant local Next 16.3.1 docs under `apps/web/node_modules/next/dist/docs/` per `apps/web/AGENTS.md`.

- [ ] **Step 1: RED snapshot tests**

Map DB row to `progressSummary`; no row → null; preserve last successful boundary/facts while target is PENDING/ERROR.

- [ ] **Step 2: RED Realtime test/inspection** ensuring `api.game_progress_summaries` invalidates the current snapshot by `game_id`.

- [ ] **Step 3: RED component tests**

Required states:

```text
0 judged: 还在探索中 / 再完成 10 个问题后整理首次总结
7 judged: 再完成 3 个问题后整理首次总结
10 judged + no successful + PENDING: 正在整理当前进度…
READY through 10: category groups + 整理至第 10 问
READY through 10 with 17 judged: 再完成 3 个问题后更新
READY through 30 + target 40 PENDING: old facts visible + 正在更新到第 40 问…
old facts + ERROR: old facts visible + 本轮总结暂时未更新
no successful + ERROR: safe failure copy only
```

Empty categories are omitted. Do not render KP count/hidden progress.

- [ ] **Step 4: Replace exact placeholder in `game-client.tsx`** with:

```tsx
<ProgressSummaryPanel messages={visibleMessages} summary={snapshot.progressSummary} />
```

Do not redesign PlayerStatsPanel/sidebar grid.

- [ ] **Step 5: GREEN**

```bash
pnpm --filter @turtle-soup/web test
pnpm --filter @turtle-soup/web typecheck
pnpm --filter @turtle-soup/web lint
pnpm --filter @turtle-soup/web build
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/game/get-current-snapshot* apps/web/src/lib/supabase-browser.ts apps/web/src/components/game apps/web/src/app/globals.css
git commit -m "feat: show current game progress summary"
```

---

## Task 9: Extend local acceptance for normal boundary, Challenge refresh, and startup 41→40 backfill

**Files:**
- Modify: `scripts/local-acceptance.mjs`
- Modify tests/docs only where required by existing acceptance harness.

- [ ] **Step 1: Extend fake judge** with `summarizeProgress(input)` returning deterministic structured content derived only from the supplied public questions.

- [ ] **Step 2: Add boundary-10 acceptance**

Create/judge 10 normal questions, process a summary job, fetch `/api/game/current`, and assert:

- `progressSummary.generationStatus === 'READY'`;
- `throughQuestionCount === 10`;
- safe facts visible in JSON;
- no solution/KP/Evidence content leaked.

- [ ] **Step 3: Add Challenge refresh acceptance**

Challenge a question within the summarized boundary so the final verdict changes; assert same boundary gets a new source fingerprint/job and refreshed public summary.

- [ ] **Step 4: Add startup backfill fixture**

Create an ACTIVE game state with **41 JUDGED normal messages and no summary/job** (direct deterministic DB fixture is acceptable inside local acceptance; do not spend provider calls merely to manufacture 41 rows).

Call the same startup reconciliation function wired by Worker startup and assert:

```text
latest eligible boundary = 40
exactly one boundary-40 job exists
throughSequenceNo equals the 40th JUDGED message sequence
```

Run reconciliation a second time and assert still exactly one job.

Then process that job with fake `summarizeProgress` and assert public READY summary through 40.

- [ ] **Step 5: Add BLOCKED restart case**

Seed/force a BLOCKED boundary-40 job with matching current fingerprint, run startup reconciliation, and assert no replacement job/attempt is created.

- [ ] **Step 6: Run acceptance and focused regression** using the repository’s existing acceptance command/package script. If no script alias exists, use the same direct invocation already used for `scripts/local-acceptance.mjs`.

- [ ] **Step 7: Commit**

```bash
git add scripts/local-acceptance.mjs
git commit -m "test: verify progress summary lifecycle"
```

---

## Task 10: Full verification and scope gate

- [ ] **Step 1: Database reset / pgTAP**

```bash
pnpm exec supabase db reset
```

- [ ] **Step 2: All tests**

```bash
pnpm test
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Lint**

```bash
pnpm lint
```

Do not “fix” unrelated pre-existing lint issues. If root lint has a known unrelated failure, run and report the relevant package lint separately and preserve evidence of the root failure.

- [ ] **Step 5: Build**

```bash
pnpm build
```

- [ ] **Step 6: Worker Docker build if current project verification already includes it**

Use the existing documented Docker command; do not invent deployment changes.

- [ ] **Step 7: Acceptance**

Run the local acceptance suite containing the new 10-boundary and 41→40 startup cases.

- [ ] **Step 8: Diff check**

```bash
git diff --check
git status --short
```

Inspect actual changed paths against this plan. No unrelated files.

- [ ] **Step 9: Final report**

Report:

- changed files;
- summary model/config used by default;
- focused + full verification results;
- confirmation that startup 41→40 acceptance passed;
- confirmation that BLOCKED restart does not bypass retry limit;
- any deviation from Spec/Plan and exact reason.

## Explicit non-goals for Codex

- No manual summary button.
- No summary history UI/table navigation.
- No summarization of ENDED games on startup.
- No new rooms/history/multi-game architecture.
- No change to KP scoring or Evidence reducer.
- No private solution/KP/Evidence input to summarizer.
- No automatic infinite retry of BLOCKED summary jobs.
- No provider benchmark unless required to fix an observed schema/runtime failure.
- No deployment/production migration unless separately authorized.