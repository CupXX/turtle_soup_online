# Game Progress Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the safe cumulative right-sidebar “当前进度” summary, reconcile missing summary work on Worker startup (for example 41 judged questions → boundary 40), and replace numeric per-message key-point point badges with one `👍` per current awarded key point beside the verdict icon.

**Architecture:** Add a public current-summary state table plus a private progress-summary job queue. A new `progress-summary` AI skill receives only public question text + current public verdict. Normal boundaries, Challenge refreshes, startup reconciliation, retries, and concurrent starts share one idempotent source-fingerprint scheduler. The message-row hit indicator is a bounded presentation-only change that consumes existing `PublicMessage.awardedPoints`; it must not alter scoring or summary input.

**Tech Stack:** TypeScript 7/6, Vitest 4, Node `crypto`, PostgreSQL/Supabase + pgTAP, existing Harness/OpenAI Responses runtimes, Next.js 16.3.1, React 19.2.8.

**Spec:** `docs/superpowers/specs/2026-08-18-game-progress-summary-design.md`

**Code baseline:** `88382241598da3c6a3d452f6586eac4b03b3bf9a`

**Updated spec commit:** `a0ed441528dd96c9155dc619d1e364019e395e47`

## Global Constraints

- Do not change verdict semantics, scoring, key-point extraction, cumulative Evidence, final-answer behavior, or challenge voting rules.
- Summary cadence uses only `api.messages.status = 'JUDGED'`; never use submitted-question count alone.
- The summarizer must never receive full solution, private key points, private Evidence, claims, awards, or scores.
- V1 summary facts come only from YES, NO, and IRRELEVANT; BOTH never creates a player-facing fact.
- Do not add `PROGRESS_SUMMARY` to `private.game_actions.action_type`.
- Keep the last successful summary visible while a newer target is PENDING or ERROR.
- Startup reconciliation applies only to the current ACTIVE game and only the latest eligible 10-question boundary.
- Restart must not bypass the four-attempt retry ceiling for an unchanged BLOCKED source.
- Same-boundary public verdict changes must produce a different deterministic source fingerprint.
- Never publish model output if the fixed source fingerprint changed before completion.
- Browser roles never receive access to private summary jobs or judge-attempt internals.
- Message-row hit display uses current `message.awardedPoints` only; no browser-side score derivation.
- `awardedPoints = N` renders exactly N visible `👍` to the right of the verdict icon; zero renders none.
- Remove visible `+N` point text from judged messages; do not change the underlying numeric field.
- Before changing Next.js/web code, read `apps/web/AGENTS.md` and the relevant local docs under `apps/web/node_modules/next/dist/docs/`.
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
- `apps/web/src/components/game/message-row.tsx`
- `apps/web/src/components/game/message-row.test.tsx`
- `apps/web/src/app/globals.css`
- `.env.example`
- `scripts/local-acceptance.mjs`
- `services/judge-worker/src/index.ts` only if required by the current export pattern.

---

## Task 1: Lock public/AI contracts, validator, and summary prompt semantics

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

No contract change is needed for hit thumbs; `PublicMessage.awardedPoints` already supplies the count.

- [ ] **Step 1: Write RED validator/contract tests**

Accept three arrays; reject extra properties, >4 items/category, empty strings, >120-char strings, and normalized exact duplicates in a category.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @turtle-soup/contracts test
pnpm --filter @turtle-soup/judge-worker test -- validate-result progress-summary
```

- [ ] **Step 3: Implement contracts and `PROGRESS_SUMMARY_SCHEMA`** using the current strict AJV path.

- [ ] **Step 4: Implement prompt**

```ts
export const PROGRESS_SUMMARY_PROMPT_VERSION = 'progress-summary-v1';
export function buildProgressSummaryPrompt(input: ProgressSummaryInput): string;
```

Prompt requirements:

- supplied public question/verdict rows are the only evidence;
- YES → confirmed proposition;
- NO → ruled-out proposition;
- IRRELEVANT → broad unrelated direction only;
- BOTH → no output fact;
- handle grammatical negation correctly;
- merge repeated/overlapping discoveries;
- never invent missing causal/identity/motive/chronology facts;
- no verdict-token wording in player-facing strings;
- exactly the three schema fields.

The input contract must not contain solution/KP/Evidence/score/award fields.

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

- [ ] **Step 3: Implement runtime routing** in `SKILLS`, prompt-version mapping, config map, both provider implementations, and the returned composite judge.

- [ ] **Step 4: Add optional env overrides**

```text
JUDGE_PROGRESS_SUMMARY_MODEL=
JUDGE_PROGRESS_SUMMARY_REASONING_EFFORT=off
```

Fallback remains `JUDGE_MODEL` + `off`.

- [ ] **Step 5: Extend audit plumbing** so `recordJudgeAttempt()` can write `progress_summary_job_id`; auditing remains best-effort.

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

## Task 3: Add public summary state, private jobs, RLS, Realtime, and audit FK

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

- [ ] **Step 1: Write RED pgTAP** covering tables/columns/checks/FKs, all-status uniqueness, browser denial on private jobs, public SELECT-only state, Worker privileges, forced RLS, Realtime publication membership, `progress_summary_job_id`, and exactly-one-parent audit constraint.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec supabase db reset
```

- [ ] **Step 3: Implement migration** following narrow permission patterns in existing migrations; do not broaden `game_web` private access.

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

## Task 4: Implement canonical source/fingerprint and shared idempotent scheduler

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

Fingerprint:

```ts
createHash('sha256')
  .update(JSON.stringify(questions.map(({ sequence_no, question, verdict }) => [sequence_no, question, verdict])))
  .digest('hex');
```

- [ ] **Step 1: RED fingerprint tests**: deterministic 64-char lowercase hex; changing verdict/question/order changes fingerprint.

- [ ] **Step 2: RED scheduler tests**

Cover:

- invalid boundary <10 / non-multiple of 10;
- exactly first N JUDGED messages in sequence order;
- PENDING excluded;
- Nth judged message determines `throughSequenceNo` despite action-sequence gaps;
- READY matching boundary+fingerprint → no job;
- any existing same-key job status → no duplicate;
- changed same-boundary verdict → new fingerprint/job;
- enqueue preserves older successful arrays while target is PENDING.

- [ ] **Step 3: RED startup reconciliation tests**

```text
0 judged  -> no-op
9 judged  -> no-op
10 judged -> ensure 10
19 judged -> ensure 10
20 judged -> ensure 20
41 judged -> ensure 40
```

Also cover READY matching 40, READY 30 → ensure 40, existing PENDING/PROCESSING/RETRY 40, BLOCKED same fingerprint, concurrent reconcile, no ACTIVE game, and ENDED-only database.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @turtle-soup/judge-worker test -- progress-summary-queue
```

- [ ] **Step 5: Implement source/fingerprint/scheduler/reconciliation** using current public `api.messages.verdict`, never private original judgment values.

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

- [ ] **Step 1: RED question cadence tests** for judged counts 9/10/11/19/20. Only 10 and 20 call the shared ensure helper. Legacy and Evidence paths behave identically.

- [ ] **Step 2: RED Challenge tests**

Cover:

- verdict unchanged → no summary scheduling;
- question 7 changed when latest boundary is 10 → ensure 10;
- question 14 changed when boundary is 10 → no refresh;
- question 17 changed when 23 judged → ensure 20;
- same-boundary changed verdict produces a different fingerprint/job;
- scoring/rebuild behavior remains unchanged.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @turtle-soup/judge-worker test -- complete-question complete-challenge
```

- [ ] **Step 4: Implement minimal calls** to the shared helper only after current public judgment state is correct. Do not duplicate fingerprint logic.

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

## Task 6: Implement summary claim, stale-safe processing, completion, retry, and blocking

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

- [ ] **Step 1: RED claim/retry tests** using existing 2s/5s/15s lease retry semantics and BLOCKED after attempt four.

- [ ] **Step 2: RED processor tests** verifying model input is exactly public source rows and contains no solution/KP/Evidence/score/award properties. Fingerprint mismatch before model call marks STALE + ensures replacement and does not call model.

- [ ] **Step 3: RED completion race tests**

Cover active lease + unchanged source, lease lost, source changing during model call, preservation of previous READY arrays, BLOCKED newest target, obsolete BLOCKED target, and exact-once completion replay.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @turtle-soup/judge-worker test -- progress-summary-processor complete-progress-summary progress-summary-queue
```

- [ ] **Step 5: Implement minimal processor/completion** with AI outside DB transaction and fingerprint revalidation inside completion transaction.

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

## Task 7: Wire startup reconciliation and summary queue into Worker lifecycle

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

Extend `WorkerLoopOptions`:

```ts
startupReconcile?: () => Promise<void>;
claimProgressSummary?: () => Promise<ClaimedProgressSummaryJob | null>;
processProgressSummary?: (job: ClaimedProgressSummaryJob) => Promise<void>;
```

- [ ] **Step 1: RED Worker lifecycle tests**

Assert heartbeat before reconcile, reconcile once per start, reconcile before first claim, missing callback safe no-op, separate summary queue without changing `ClaimedAction.actionType`, and unchanged abort/finally heartbeat behavior.

- [ ] **Step 2: RED `main.ts` wiring tests** for default startup reconciliation and progress-summary audit parent.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @turtle-soup/judge-worker test -- worker main
```

- [ ] **Step 4: Implement startup hook**

```ts
await options.heartbeat();
await options.startupReconcile?.();
// then while loop
```

Do not place reconciliation in the heartbeat interval.

- [ ] **Step 5: Wire separate summary queue** while preserving ordered game-action semantics. Recommended loop priority:

```text
claim extraction
→ claim game action
→ claim progress summary
→ idle
```

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

## Task 8: Expose summary state in snapshot/Realtime and replace sidebar placeholder

**Files:**
- Modify: `apps/web/src/server/game/get-current-snapshot.ts`
- Modify: `apps/web/src/server/game/get-current-snapshot.test.ts`
- Modify: `apps/web/src/lib/supabase-browser.ts`
- Create: `apps/web/src/components/game/progress-summary-panel.tsx`
- Create: `apps/web/src/components/game/progress-summary-panel.test.tsx`
- Modify: `apps/web/src/components/game/game-client.tsx`
- Modify: `apps/web/src/components/game/game-client.integration.test.tsx`
- Modify: `apps/web/src/app/globals.css`

Before editing, read `apps/web/AGENTS.md` and relevant local Next 16.3.1 docs.

- [ ] **Step 1: RED snapshot tests**: DB row mapping, null state, and preservation of last successful boundary/facts while target is PENDING/ERROR.

- [ ] **Step 2: RED Realtime test/inspection** ensuring `api.game_progress_summaries` invalidates the snapshot by `game_id`.

- [ ] **Step 3: RED component tests**

```text
0 judged: 还在探索中 / 再完成 10 个问题后整理首次总结
7 judged: 再完成 3 个问题后整理首次总结
10 judged + no successful + PENDING: 正在整理当前进度…
READY through 10: categories + 整理至第 10 问
READY through 10 with 17 judged: 再完成 3 个问题后更新
READY through 30 + target 40 PENDING: old facts + 正在更新到第 40 问…
old facts + ERROR: old facts + 本轮总结暂时未更新
no successful + ERROR: safe failure copy only
```

Empty categories are omitted. Do not render hidden KP count in this card.

- [ ] **Step 4: Replace placeholder** in `game-client.tsx` with:

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
git add apps/web/src/server/game/get-current-snapshot* apps/web/src/lib/supabase-browser.ts apps/web/src/components/game/progress-summary-panel* apps/web/src/components/game/game-client* apps/web/src/app/globals.css
git commit -m "feat: show current game progress summary"
```

---

## Task 9: Replace numeric point badges with thumbs-up key-point hit indicators

**Files:**
- Modify: `apps/web/src/components/game/message-row.tsx`
- Modify: `apps/web/src/components/game/message-row.test.tsx`
- Modify: `apps/web/src/app/globals.css`

**Consumes:** existing `PublicMessage.awardedPoints` and existing `reactionForVerdict()` output.

**Produces:** presentation only; no contract, database, Worker, scoring, or reducer changes.

**Required visible mapping:**

```text
awardedPoints = 0 → ✅
awardedPoints = 1 → ✅ 👍
awardedPoints = 2 → ✅ 👍👍
```

The same mapping applies regardless of verdict icon (`✅`, `❌`, `❓`, `👎`): thumbs represent key-point awards, not verdict class.

- [ ] **Step 1: Update/write RED `MessageRow` tests**

Replace the existing test expectation for `+1` and add explicit cases:

```tsx
const oneHit = { ...message, awardedPoints: 1 };
const twoHits = { ...message, awardedPoints: 2 };
const noHit = { ...message, awardedPoints: 0 };
```

Assertions:

- one hit renders verdict and exactly one visible `👍`;
- one hit does not render `+1`;
- two hits render exactly `👍👍` / two thumbs and no `+2`;
- zero hit renders no thumb and no numeric points;
- thumbs are in the same reaction line/container as the verdict icon, not beneath it;
- accessible judgment label includes `触发 1 个关键点` / `触发 2 个关键点` when positive;
- existing own/other alignment and challenge-state tests still pass.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @turtle-soup/web test -- message-row
```

Expected: existing implementation still renders `+N` and fails the new thumb assertions.

- [ ] **Step 3: Implement minimal markup** in `message-row.tsx`.

Recommended shape:

```tsx
<div
  className="message-result"
  aria-label={judged
    ? `判定 ${message.verdict}${message.awardedPoints > 0 ? `，触发 ${message.awardedPoints} 个关键点` : ''}`
    : statusText(message)}
>
  <span className="reaction-line">
    <span className="reaction" aria-hidden={judged ? undefined : true}>
      {statusText(message)}
    </span>
    {message.awardedPoints > 0 ? (
      <span className="key-point-hits" aria-hidden="true">
        {'👍'.repeat(message.awardedPoints)}
      </span>
    ) : null}
  </span>
</div>
```

Equivalent markup is allowed if it preserves the exact visible/accessibility contract. Delete the `+{message.awardedPoints}` presentation.

- [ ] **Step 4: Update CSS minimally**

Add compact inline styling such as:

```css
.reaction-line {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.key-point-hits {
  white-space: nowrap;
  line-height: 1;
}
```

Remove `.points` styling only if no other current component uses it. Do not change message width, grid columns, bubble alignment, or challenge layout.

- [ ] **Step 5: Run GREEN and web regression**

```bash
pnpm --filter @turtle-soup/web test -- message-row
pnpm --filter @turtle-soup/web test
pnpm --filter @turtle-soup/web typecheck
pnpm --filter @turtle-soup/web lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/game/message-row.tsx apps/web/src/components/game/message-row.test.tsx apps/web/src/app/globals.css
git commit -m "feat: show key point hits with thumbs"
```

---

## Task 10: Extend local acceptance for summary boundary, Challenge refresh, and startup 41→40 backfill

**Files:**
- Modify: `scripts/local-acceptance.mjs`

- [ ] **Step 1: Extend fake judge** with `summarizeProgress(input)` returning deterministic structured content derived only from supplied public questions.

- [ ] **Step 2: Boundary-10 acceptance**

Create/judge 10 normal questions, process a summary job, fetch `/api/game/current`, and assert READY through 10 with safe facts and no solution/KP/Evidence leakage.

- [ ] **Step 3: Challenge refresh acceptance**

Challenge a question inside the summarized boundary so the public verdict changes; assert a new same-boundary fingerprint/job and refreshed public summary.

- [ ] **Step 4: Startup backfill fixture**

Create an ACTIVE game with **41 JUDGED normal messages and no summary/job** using a deterministic DB fixture; do not spend provider calls to manufacture 41 rows.

Run the same startup reconciliation function wired by Worker and assert:

```text
latest eligible boundary = 40
exactly one boundary-40 job exists
throughSequenceNo = sequence of the 40th JUDGED message
```

Run reconciliation again and assert still exactly one job. Process it with fake summarizer and assert public READY through 40.

- [ ] **Step 5: BLOCKED restart case**

Seed/force a BLOCKED boundary-40 job with matching current fingerprint, run startup reconciliation, and assert no replacement job/attempt.

- [ ] **Step 6: Run acceptance** using the repository's existing local-acceptance invocation.

- [ ] **Step 7: Commit**

```bash
git add scripts/local-acceptance.mjs
git commit -m "test: verify progress summary lifecycle"
```

---

## Task 11: Full verification and scope gate

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

Do not fix unrelated pre-existing lint issues. If root lint has an unrelated existing failure, preserve evidence and run/report relevant package lint separately.

- [ ] **Step 5: Build**

```bash
pnpm build
```

- [ ] **Step 6: Worker Docker build** only if current repository verification already includes it; do not invent deployment changes.

- [ ] **Step 7: Acceptance**

Run local acceptance containing boundary-10, Challenge refresh, 41→40 startup, and BLOCKED restart cases.

- [ ] **Step 8: Focused hit-indicator confirmation**

Ensure `MessageRow` tests explicitly prove:

```text
0 points → 0 thumbs
1 point  → 1 thumb
2 points → 2 thumbs
no visible +1/+2 text
```

- [ ] **Step 9: Diff check**

```bash
git diff --check
git status --short
```

Inspect changed paths against this plan. No unrelated files.

- [ ] **Step 10: Final report**

Report:

- changed files;
- summary model/config used by default;
- focused + full verification results;
- startup 41→40 acceptance result;
- confirmation BLOCKED restart does not bypass retry limit;
- confirmation message-row `awardedPoints` maps 1:1 to visible thumbs and no numeric `+N` remains;
- any deviation from Spec/Plan and exact reason.

## Explicit non-goals for Codex

- No manual summary button.
- No summary history UI/table navigation.
- No summarization of ENDED games on startup.
- No new rooms/history/multi-game architecture.
- No change to KP scoring or Evidence reducer.
- No private solution/KP/Evidence/award input to summarizer.
- No automatic infinite retry of BLOCKED summary jobs.
- No redesign of message bubbles or sidebar layout.
- No replacement of the existing `awardedPoints` field with a new hit-count field.
- No provider benchmark unless required to fix an observed schema/runtime failure.
- No deployment/production migration unless separately authorized.