# Game Progress Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right-sidebar “当前进度” placeholder with a safe cumulative AI summary that updates every 10 judged normal questions and automatically refreshes when a challenge changes an already-summarized verdict.

**Architecture:** Add a public current-summary state table plus a private summary-job queue. The serial Worker runs a new `progress-summary` AI skill over **public question text + current public verdict only**, publishes structured safe summary text, and keeps summary work separate from the ordered `game_actions` queue. The web snapshot and Realtime layer expose the current summary to a focused sidebar component.

**Tech Stack:** TypeScript 7/6, Vitest 4, PostgreSQL/Supabase + pgTAP, existing Worker/Harness/OpenAI Responses runtimes, Next.js 16.3.1, React 19.2.8.

**Spec:** `docs/superpowers/specs/2026-08-18-game-progress-summary-design.md`

**Code baseline:** `88382241598da3c6a3d452f6586eac4b03b3bf9a`

**Spec commit:** `72cb3387c7aefb81752e3854db81c3202aecb74d`

## Global Constraints

- Do not change verdict semantics, scoring, key-point extraction, cumulative Evidence behavior, final-answer behavior, or challenge voting rules.
- Summary cadence is based on **JUDGED normal messages**, never submitted-question count alone.
- The summarizer must never receive full solution, private key points, private Evidence, claims, or scores.
- V1 emits facts only from YES, NO, and IRRELEVANT; BOTH must not generate a player-facing fact.
- Summary work stays outside `private.game_actions`; do not add a `PROGRESS_SUMMARY` game action type.
- Keep the previous successful summary visible while a refresh is pending or fails.
- All AI outputs use strict structured validation and existing retry semantics.
- Browser roles never receive access to the private summary-job queue or judge-attempt internals.
- Before changing Next.js-specific web code, read the relevant local docs under `apps/web/node_modules/next/dist/docs/` as required by `apps/web/AGENTS.md`.
- Do not refactor unrelated code or redesign the dashboard.

---

## File map

### Create

- `services/judge-worker/src/skills/progress-summary.ts` — prompt builder and `progress-summary-v1` version constant.
- `services/judge-worker/src/skills/progress-summary.test.ts` — prompt safety/semantics tests.
- `services/judge-worker/src/processors/progress-summary-processor.ts` — load fixed public input boundary and invoke the model.
- `services/judge-worker/src/processors/progress-summary-processor.test.ts` — processor boundary/input tests.
- `services/judge-worker/src/db/progress-summary-queue.ts` — enqueue/claim/retry/block summary jobs.
- `services/judge-worker/src/db/progress-summary-queue.test.ts` — queue idempotency/retry tests.
- `services/judge-worker/src/db/complete-progress-summary.ts` — short leased completion transaction.
- `services/judge-worker/src/db/complete-progress-summary.test.ts` — publish/lease/stale-state tests.
- `apps/web/src/components/game/progress-summary-panel.tsx` — sidebar UI.
- `apps/web/src/components/game/progress-summary-panel.test.tsx` — all visual states.
- `supabase/migrations/20260818173000_game_progress_summary.sql` — public summary table, private job queue, audit parent, grants/RLS/Realtime.
- `supabase/tests/database/008_game_progress_summary.test.sql` — schema/security/queue/public-state database tests.

### Modify

- `packages/contracts/src/game.ts` — public summary types + `PublicGameSnapshot.progressSummary`.
- `packages/contracts/src/judge.ts` — summary AI input/result + `SemanticJudge.summarizeProgress`.
- `packages/contracts/src/contracts.test.ts` — contract fixture coverage if required by current tests.
- `services/judge-worker/src/skills/validate-result.ts` — strict progress-summary schema/validator.
- `services/judge-worker/src/skills/validate-result.test.ts` if present; otherwise add focused cases to the nearest existing skill validator test file.
- `services/judge-worker/src/runtime/semantic-judge.ts` — add `progress-summary` to `HarnessSkill`.
- `services/judge-worker/src/runtime/harness-semantic-judge.ts` — call new prompt/schema/validator.
- `services/judge-worker/src/runtime/openai-responses-semantic-judge.ts` — same skill for OpenAI Responses.
- `services/judge-worker/src/runtime/create-semantic-judge.ts` — fourth skill runtime/config routing and metadata.
- `services/judge-worker/src/runtime/audited-semantic-judge.ts` — audited `summarizeProgress` call.
- `services/judge-worker/src/db/judge-attempts.ts` — third parent type `progressSummaryJobId`.
- `services/judge-worker/src/config.ts` — optional per-skill model/reasoning overrides.
- `services/judge-worker/src/config.test.ts` — default and override coverage.
- `.env.example` — document two new optional environment variables.
- `services/judge-worker/src/worker.ts` — claim/process summary jobs without changing `game_actions` action types.
- `services/judge-worker/src/worker.test.ts` — summary-loop ordering/dispatch coverage.
- `services/judge-worker/src/main.ts` — wire claim/process/retry/audit dependencies.
- `services/judge-worker/src/main.test.ts` — runtime wiring coverage.
- `services/judge-worker/src/db/complete-question.ts` — enqueue at each judged 10-question boundary.
- `services/judge-worker/src/db/complete-question.test.ts` — 9/10/20 cadence and idempotency.
- `services/judge-worker/src/db/complete-challenge.ts` — enqueue refresh only when an already-summarized verdict changes.
- `services/judge-worker/src/db/complete-challenge.test.ts` — in-boundary/out-of-boundary refresh coverage.
- `apps/web/src/server/game/get-current-snapshot.ts` — include public progress summary.
- `apps/web/src/server/game/get-current-snapshot.test.ts` — map/null/READY/PENDING summary rows.
- `apps/web/src/lib/supabase-browser.ts` — Realtime subscription for `api.game_progress_summaries`.
- `apps/web/src/components/game/game-client.tsx` — replace placeholder with `ProgressSummaryPanel`.
- `apps/web/src/components/game/game-client.integration.test.tsx` — snapshot integration for the sidebar.
- `apps/web/src/app/globals.css` — focused summary typography/status styles.
- `services/judge-worker/src/index.ts` only if current export style requires exposing the new processor/queue helper.

---

### Task 1: Lock the contracts and strict summary semantics

**Files:**
- Modify: `packages/contracts/src/game.ts`
- Modify: `packages/contracts/src/judge.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Create: `services/judge-worker/src/skills/progress-summary.ts`
- Create: `services/judge-worker/src/skills/progress-summary.test.ts`
- Modify: `services/judge-worker/src/skills/validate-result.ts`
- Test: nearest existing validator test file plus `progress-summary.test.ts`

**Interfaces:**

Produces these exact contracts for later tasks:

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

`SemanticJudge` gains:

```ts
summarizeProgress(input: ProgressSummaryInput): Promise<ProgressSummaryResult>;
```

`PublicGameSnapshot` gains:

```ts
progressSummary: PublicGameProgressSummary | null;
```

- [ ] **Step 1: Write RED contract/validator tests**

Cover:

```ts
expect(validateProgressSummaryResult({
  confirmed_facts: ['死者的死亡与她扔出的物体有关。'],
  ruled_out_facts: ['这不是一起自杀。'],
  irrelevant_topics: ['天气因素与事件无关。'],
})).toEqual(expect.objectContaining({ confirmed_facts: expect.any(Array) }));
```

Also assert rejection of:

- additional properties;
- 5 items in one category;
- empty strings;
- strings over 120 characters;
- exact normalized duplicates within one category.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter @turtle-soup/contracts test
pnpm --filter @turtle-soup/judge-worker test -- progress-summary validate-result
```

Expected: compile/test failure because summary contracts/prompt/schema do not exist.

- [ ] **Step 3: Implement the contracts and strict schema**

Add `PROGRESS_SUMMARY_SCHEMA` to `validate-result.ts` with exactly:

```ts
{
  type: 'object',
  additionalProperties: false,
  required: ['confirmed_facts', 'ruled_out_facts', 'irrelevant_topics'],
  properties: {
    confirmed_facts: {
      type: 'array', maxItems: 4,
      items: { type: 'string', minLength: 1, maxLength: 120 },
    },
    ruled_out_facts: {
      type: 'array', maxItems: 4,
      items: { type: 'string', minLength: 1, maxLength: 120 },
    },
    irrelevant_topics: {
      type: 'array', maxItems: 4,
      items: { type: 'string', minLength: 1, maxLength: 120 },
    },
  },
}
```

`validateProgressSummaryResult()` must use the same JSON parsing path as existing skills and reject duplicate NFKC/lowercased strings within each category.

- [ ] **Step 4: Implement `progress-summary-v1` prompt builder**

Export:

```ts
export const PROGRESS_SUMMARY_PROMPT_VERSION = 'progress-summary-v1';
export function buildProgressSummaryPrompt(input: ProgressSummaryInput): string;
```

The prompt must explicitly state:

- only supplied public questions/verdicts are evidence;
- never invent facts not established by them;
- YES → confirmed proposition, with correct handling of grammatical negation;
- NO → ruled-out proposition, with correct handling of grammatical negation;
- IRRELEVANT → only broad unrelated topic, never a hidden story fact;
- BOTH → do not emit a fact;
- merge duplicates/near-duplicates;
- do not mention verdict tokens in output;
- return exactly the schema fields.

Do **not** add puzzle surface, solution, key points, Evidence, score, or claims to this input type or prompt.

- [ ] **Step 5: Add prompt safety tests**

Use a mixed input containing YES, NO, BOTH, and IRRELEVANT and assert the built prompt contains the public question strings/verdicts but does not contain fields named `full_solution`, `key_points`, `evidence`, or scoring/claim payloads.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
pnpm --filter @turtle-soup/contracts test
pnpm --filter @turtle-soup/contracts typecheck
pnpm --filter @turtle-soup/judge-worker test -- progress-summary
pnpm --filter @turtle-soup/judge-worker typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src services/judge-worker/src/skills
git commit -m "feat: define progress summary contracts"
```

---

### Task 2: Wire the fourth AI skill through both runtimes and audit

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
- Test: existing runtime tests in the same directories

**Interfaces:**

`HarnessSkill` becomes:

```ts
export type HarnessSkill =
  | 'key-point-extraction'
  | 'question-judge'
  | 'final-answer-judge'
  | 'progress-summary';
```

`JudgeAttemptParent` becomes a three-way exclusive union:

```ts
export type JudgeAttemptParent =
  | { actionId: string; extractionJobId?: never; progressSummaryJobId?: never; attemptNo: number }
  | { extractionJobId: string; actionId?: never; progressSummaryJobId?: never; attemptNo: number }
  | { progressSummaryJobId: string; actionId?: never; extractionJobId?: never; attemptNo: number };
```

- [ ] **Step 1: Write RED runtime/config tests**

Assert:

- `progress-summary` is included in skill creation;
- `JUDGE_PROGRESS_SUMMARY_MODEL` overrides only this skill;
- `JUDGE_PROGRESS_SUMMARY_REASONING_EFFORT` overrides only this skill;
- absent overrides fall back to `JUDGE_MODEL` and `off`;
- Harness runtime calls `buildProgressSummaryPrompt` + `PROGRESS_SUMMARY_SCHEMA`;
- OpenAI Responses runtime uses a strict schema name such as `progress_summary`;
- audited runtime records skill `progress-summary` against `progressSummaryJobId`.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @turtle-soup/judge-worker test -- config runtime
```

Expected: FAIL because the fourth skill does not exist.

- [ ] **Step 3: Implement runtime routing**

Add `progress-summary` to `SKILLS`, `PROMPT_VERSIONS`, and `skillConfigs`. Extend the returned judge:

```ts
summarizeProgress: (input) => judges['progress-summary'].summarizeProgress(input),
```

Harness implementation:

```ts
summarizeProgress(input: ProgressSummaryInput): Promise<ProgressSummaryResult> {
  return this.call(
    'progress-summary',
    buildProgressSummaryPrompt(input),
    PROGRESS_SUMMARY_SCHEMA,
    validateProgressSummaryResult,
  );
}
```

OpenAI implementation should use the same prompt/schema/validator through the existing `call()` function.

- [ ] **Step 4: Extend audit parent plumbing**

`recordJudgeAttempt()` must write `progress_summary_job_id` when that parent is selected and null for the other two parent columns. Keep auditing best-effort in `createAuditedSemanticJudge()`.

- [ ] **Step 5: Document env overrides**

Add to `.env.example` without making them required:

```text
JUDGE_PROGRESS_SUMMARY_MODEL=
JUDGE_PROGRESS_SUMMARY_REASONING_EFFORT=off
```

Follow the existing comments/format in the file.

- [ ] **Step 6: Run runtime tests/typecheck**

```bash
pnpm --filter @turtle-soup/judge-worker test
pnpm --filter @turtle-soup/judge-worker typecheck
```

Expected: PASS before database migration tests are introduced.

- [ ] **Step 7: Commit**

```bash
git add .env.example services/judge-worker/src/runtime services/judge-worker/src/db/judge-attempts.ts services/judge-worker/src/config.ts services/judge-worker/src/config.test.ts
git commit -m "feat: add progress summary judge skill"
```

---

### Task 3: Add the public summary state, private queue, permissions, and audit FK

**Files:**
- Create: `supabase/migrations/20260818173000_game_progress_summary.sql`
- Create: `supabase/tests/database/008_game_progress_summary.test.sql`
- Inspect while implementing: `supabase/migrations/20260814141343_security_and_realtime.sql`
- Inspect while implementing: `supabase/migrations/20260814170905_narrow_runtime_permissions.sql`

**Produces:**

`api.game_progress_summaries` and `private.progress_summary_jobs` exactly as specified in the design, plus `private.judge_attempts.progress_summary_job_id`.

- [ ] **Step 1: Write RED pgTAP tests**

The database suite must assert:

1. both tables exist;
2. summary row constraints reject negative boundaries and invalid statuses;
3. job rows reject non-multiples of 10 and invalid statuses;
4. active duplicate `(game_id, through_question_count, through_sequence_no)` jobs are rejected;
5. a completed historical job does not prevent a later refresh job for the same boundary;
6. anon/authenticated can SELECT `api.game_progress_summaries` but cannot INSERT/UPDATE;
7. `game_web` can SELECT public summaries but cannot write them and has no access to private jobs;
8. `judge_worker` can SELECT/INSERT/UPDATE both the public state and private jobs but cannot DELETE unless an existing queue pattern explicitly requires it;
9. anon/authenticated cannot access private jobs;
10. `private.judge_attempts.progress_summary_job_id` references the job table and the parent integrity check allows exactly one parent source;
11. the public summary table is in `supabase_realtime` when that publication exists.

- [ ] **Step 2: Run reset/tests and verify RED**

```bash
pnpm exec supabase db reset
pnpm exec supabase test db
```

Expected: FAIL because migration objects do not exist.

- [ ] **Step 3: Implement the migration**

Create the public table with:

```sql
generation_status text not null
  check (generation_status in ('PENDING', 'READY', 'ERROR'))
```

Create the private queue with statuses:

```text
PENDING PROCESSING RETRY BLOCKED COMPLETED CANCELLED
```

Create the active partial unique index for `PENDING`, `PROCESSING`, `RETRY`.

Add the public table to `supabase_realtime` with duplicate-object protection matching the existing migration style.

Apply forced RLS and exact narrow grants described in the spec.

Extend `judge_attempts` parent integrity so one and only one of `action_id`, `extraction_job_id`, `progress_summary_job_id` is non-null.

- [ ] **Step 4: Run database suite**

```bash
pnpm exec supabase db reset
pnpm exec supabase test db
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260818173000_game_progress_summary.sql supabase/tests/database/008_game_progress_summary.test.sql
git commit -m "feat: add progress summary persistence"
```

---

### Task 4: Implement the summary queue, processor, retry, and leased completion

**Files:**
- Create: `services/judge-worker/src/db/progress-summary-queue.ts`
- Create: `services/judge-worker/src/db/progress-summary-queue.test.ts`
- Create: `services/judge-worker/src/processors/progress-summary-processor.ts`
- Create: `services/judge-worker/src/processors/progress-summary-processor.test.ts`
- Create: `services/judge-worker/src/db/complete-progress-summary.ts`
- Create: `services/judge-worker/src/db/complete-progress-summary.test.ts`

**Interfaces:**

```ts
export type ClaimedProgressSummaryJob = {
  id: string;
  gameId: string;
  throughQuestionCount: number;
  throughSequenceNo: number;
  attempt: number;
  leaseOwner: string;
  leaseExpiresAt: string;
};

export async function enqueueProgressSummary(
  input: { gameId: string; throughQuestionCount: number; throughSequenceNo: number },
  dependencies?: { transaction?: WorkerTransaction },
): Promise<void>;

export async function claimNextProgressSummary(
  workerId: string,
  now: Date,
  dependencies?: { transaction?: WorkerTransaction },
): Promise<ClaimedProgressSummaryJob | null>;

export async function recordProgressSummaryRetry(
  jobId: string,
  attempt: number,
  code: Exclude<JudgeErrorCode, 'LEASE_LOST'>,
  dependencies?: QueueDependencies,
): Promise<void>;
```

Processor dependency:

```ts
type ProgressSummaryProcessorDependencies = {
  judge: SemanticJudge;
  workerId: string;
  sql?: Sql;
  transaction?: WorkerTransaction;
  now?: Date;
};
```

- [ ] **Step 1: Write RED queue tests**

Cover:

- enqueue boundary 10 creates one PENDING job and PENDING public state;
- repeated enqueue of the same active boundary is idempotent;
- enqueue boundary 20 cancels older PENDING/RETRY boundary 10 jobs;
- previous READY content/through metadata are preserved when status flips to PENDING;
- claim increments attempt and leases for 60 seconds;
- retry schedule is 2s, 5s, 15s and fourth failure blocks;
- blocking sets public ERROR only when the blocked job is still the newest requested boundary.

Reuse constants or logic from `db/queue.ts` instead of silently introducing a different retry policy.

- [ ] **Step 2: Write RED processor input-isolation tests**

Mock SQL rows and assert `judge.summarizeProgress()` receives exactly:

```ts
{
  questions: [
    { sequence_no: 1, question: '...', verdict: 'YES' },
    { sequence_no: 2, question: '...', verdict: 'NO' },
  ],
}
```

Assert no secret/key-point/Evidence query is made. The processor may query only the job row and public messages required to build the boundary.

Assert mismatch between job `throughQuestionCount` and loaded JUDGED row count throws a retryable schema/input error and never calls completion.

- [ ] **Step 3: Write RED completion tests**

Cover:

- live lease + active game publishes arrays, target boundary, generated timestamp, READY, and COMPLETED job;
- expired/wrong lease is a no-op;
- completed job replay is a no-op;
- invalid target game/state does not publish;
- older job completion cannot overwrite a newer already-published higher boundary;
- summary completion never updates scores, messages, judgments, claims, or discovered counts.

- [ ] **Step 4: Implement queue and processor**

`processProgressSummary()` must call the model outside the completion transaction.

Load messages with a query equivalent to:

```sql
select sequence_no, content, verdict
from api.messages
where game_id = $game
  and status = 'JUDGED'
  and sequence_no <= $through_sequence_no
order by sequence_no asc;
```

Reject any null verdict and require exactly `throughQuestionCount` rows.

- [ ] **Step 5: Implement leased completion**

Use the same `activeLease()` pattern as existing completion modules. Before publishing, lock the job row, validate active lease, lock/read the current public summary row, and prevent a lower boundary from overwriting a higher one.

- [ ] **Step 6: Run focused Worker tests**

```bash
pnpm --filter @turtle-soup/judge-worker test -- progress-summary
pnpm --filter @turtle-soup/judge-worker typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/judge-worker/src/db/progress-summary-* services/judge-worker/src/processors/progress-summary-*
git commit -m "feat: process progress summary jobs"
```

---

### Task 5: Trigger summaries from question completion and challenge corrections

**Files:**
- Modify: `services/judge-worker/src/db/complete-question.ts`
- Modify: `services/judge-worker/src/db/complete-question.test.ts`
- Modify: `services/judge-worker/src/db/complete-challenge.ts`
- Modify: `services/judge-worker/src/db/complete-challenge.test.ts`
- Reuse: `services/judge-worker/src/db/progress-summary-queue.ts`

**Consumes:** `enqueueProgressSummary()` from Task 4.

- [ ] **Step 1: Write RED question-cadence tests**

Use transaction fakes/fixtures to cover:

- judged count 9 → no enqueue;
- judged count 10 → enqueue `{ throughQuestionCount: 10, throughSequenceNo: currentMessage.sequenceNo }` exactly once;
- judged count 11 → no enqueue;
- judged count 20 → enqueue boundary 20;
- action retry/replayed `completeQuestion()` cannot duplicate the active job;
- both legacy key-point mode and cumulative Evidence mode follow the same cadence after successful judgment completion.

Do not use `api.games.total_question_count` as the assertion source.

- [ ] **Step 2: Run question tests and verify RED**

```bash
pnpm --filter @turtle-soup/judge-worker test -- complete-question
```

Expected: FAIL because no summary enqueue exists.

- [ ] **Step 3: Implement question-boundary scheduling**

Keep all existing judgment/scoring writes intact. After the message is transitioned to JUDGED and the derived progress work is complete, count JUDGED messages for the game in the same transaction. On a positive multiple of 10, enqueue the fixed boundary.

The enqueue helper must be transaction-aware so a failed question completion cannot leave an orphan summary job.

- [ ] **Step 4: Write RED challenge-refresh tests**

Cover all four cases:

1. verdict changed + challenged sequence inside published boundary → enqueue refresh using the published boundary;
2. verdict unchanged → no refresh;
3. verdict changed + challenged sequence after published boundary → no refresh;
4. no existing public summary → no refresh.

Run these for both legacy challenge resolution and Evidence-mode resolution.

- [ ] **Step 5: Implement challenge refresh**

Capture the pre-resolution current verdict before the update. After the challenge resolution has established the final current verdict, query the public summary state. Enqueue only when the spec’s four conditions hold.

Do not trigger refresh merely because covered key-point IDs or Evidence IDs changed while the verdict stayed the same; the summarizer does not receive those hidden values.

- [ ] **Step 6: Run focused + cumulative Evidence tests**

```bash
pnpm --filter @turtle-soup/judge-worker test -- complete-question complete-challenge
pnpm --filter @turtle-soup/game-core test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/judge-worker/src/db/complete-question* services/judge-worker/src/db/complete-challenge*
git commit -m "feat: schedule cumulative progress summaries"
```

---

### Task 6: Wire the summary queue into the serial Worker and audited runtime

**Files:**
- Modify: `services/judge-worker/src/worker.ts`
- Modify: `services/judge-worker/src/worker.test.ts`
- Modify: `services/judge-worker/src/main.ts`
- Modify: `services/judge-worker/src/main.test.ts`
- Modify: `services/judge-worker/src/index.ts` only if export conventions require it

**Worker-loop contract:**

Extend options with:

```ts
claimProgressSummary?: () => Promise<ClaimedProgressSummaryJob | null>;
processProgressSummary?: (job: ClaimedProgressSummaryJob) => Promise<void>;
```

Summary jobs are not `ClaimedAction` and never go through `processClaimedAction()`.

- [ ] **Step 1: Write RED worker-loop tests**

Assert:

- extraction behavior remains first and unchanged;
- when a ready summary job exists, it can be processed without fabricating a game action;
- a summary job is processed before the next normal action once it is ready;
- when no summary exists, normal action behavior is unchanged;
- missing `processProgressSummary` for a claimed summary throws the same style of configuration error as existing queue processors.

- [ ] **Step 2: Write RED main wiring tests**

Assert `startWorker()`:

- claims summary jobs with the same worker ID;
- wraps the summary call in `createAuditedSemanticJudge(runtime, { progressSummaryJobId: job.id, attemptNo: job.attempt }, recorder)`;
- routes retryable timeout/transport/schema failures into `recordProgressSummaryRetry()`;
- does not route summary failures into `recordActionRetry()`.

- [ ] **Step 3: Implement loop/wiring**

Recommended serial order in active play:

```text
extraction job -> progress summary job -> game action -> idle
```

Extraction jobs only matter while a game is WAITING, so this order adds at most one summary model call at a scheduled boundary before later game actions continue. Do not introduce a second process/deployment in V1.

- [ ] **Step 4: Run Worker suite**

```bash
pnpm --filter @turtle-soup/judge-worker test
pnpm --filter @turtle-soup/judge-worker typecheck
pnpm --filter @turtle-soup/judge-worker build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/judge-worker/src/worker* services/judge-worker/src/main* services/judge-worker/src/index.ts
git commit -m "feat: run progress summaries in worker"
```

---

### Task 7: Expose the public summary in snapshot and Realtime

**Files:**
- Modify: `apps/web/src/server/game/get-current-snapshot.ts`
- Modify: `apps/web/src/server/game/get-current-snapshot.test.ts`
- Modify: `apps/web/src/lib/supabase-browser.ts`
- Test: existing Realtime/browser helper tests if present

**Produces:** `PublicGameSnapshot.progressSummary` for Task 8.

- [ ] **Step 1: Read local Next.js docs before web edits**

From `apps/web`, inspect the relevant Next 16.3.1 documentation in `node_modules/next/dist/docs/` before changing framework-specific server/client boundaries. Do not rely on older Next behavior from memory.

- [ ] **Step 2: Write RED snapshot tests**

Cover:

- no row → `progressSummary: null`;
- PENDING row with previous content maps correctly;
- READY row maps snake_case DB columns to camelCase contract fields;
- ERROR row remains safe and contains no private error code;
- ended-game snapshot still returns the last summary row alongside reveal.

Update existing snapshot object expectations so `progressSummary` is explicit rather than optional.

- [ ] **Step 3: Implement snapshot query**

Add a query for one row:

```sql
select
  game_id as "gameId",
  through_question_count as "throughQuestionCount",
  through_sequence_no as "throughSequenceNo",
  confirmed_facts as "confirmedFacts",
  ruled_out_facts as "ruledOutFacts",
  irrelevant_topics as "irrelevantTopics",
  generation_status as "generationStatus",
  generated_at as "generatedAt",
  updated_at as "updatedAt"
from api.game_progress_summaries
where game_id = ${game.id}
limit 1;
```

Return `progressSummary: summaryRows[0] ?? null`.

- [ ] **Step 4: Add Realtime invalidation**

In `subscribeToPublicTables()`, add:

```ts
.on(
  'postgres_changes',
  { event: '*', schema: 'api', table: 'game_progress_summaries', filter: `game_id=eq.${gameId}` },
  onInvalidate,
)
```

Do not create a second channel.

- [ ] **Step 5: Run web server/helper tests**

```bash
pnpm --filter @turtle-soup/web test -- get-current-snapshot supabase-browser
pnpm --filter @turtle-soup/web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/game/get-current-snapshot* apps/web/src/lib/supabase-browser.ts
git commit -m "feat: expose progress summary snapshot"
```

---

### Task 8: Replace the “当前进度” placeholder with the real sidebar component

**Files:**
- Create: `apps/web/src/components/game/progress-summary-panel.tsx`
- Create: `apps/web/src/components/game/progress-summary-panel.test.tsx`
- Modify: `apps/web/src/components/game/game-client.tsx`
- Modify: `apps/web/src/components/game/game-client.integration.test.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interface:**

```ts
type ProgressSummaryPanelProps = {
  messages: PublicMessage[];
  summary: PublicGameProgressSummary | null;
};
```

- [ ] **Step 1: Write RED component tests for all six states**

Use judged messages as fixtures and cover:

1. 0 judged → `再完成 10 个问题后整理首次总结`;
2. 9 judged → `再完成 1 个问题后整理首次总结`;
3. >=10 judged + PENDING/no content → `正在整理当前进度…`;
4. READY through 10 with 13 judged → categories + `整理至第 10 问` + `再完成 7 个问题后更新`;
5. PENDING with previous READY content retained → facts remain visible + `正在更新…`;
6. ERROR with previous content → facts remain visible + `本轮总结暂时未更新`;
7. ERROR without content → `当前进度暂时无法整理`;
8. empty categories are not rendered;
9. BOTH messages affect judged count but no category text is manufactured in the component—the AI result remains the only summary content source.

- [ ] **Step 2: Run component tests and verify RED**

```bash
pnpm --filter @turtle-soup/web test -- progress-summary-panel
```

Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement `ProgressSummaryPanel`**

Compute:

```ts
const judgedQuestionCount = messages.filter((message) => message.status === 'JUDGED').length;
const nextBoundary = Math.max(10, Math.ceil((judgedQuestionCount + 1) / 10) * 10);
const remaining = nextBoundary - judgedQuestionCount;
```

For a READY summary, render the next boundary based on `summary.throughQuestionCount + 10` so a just-completed boundary does not briefly show an incorrect countdown while the next snapshot is loading.

Render headings exactly:

```text
当前进度
整理至第 N 问
目前可以确定
已经排除
无关方向
```

Use semantic lists or paragraphs with concise typography; do not use raw verdict emojis inside the summary card.

- [ ] **Step 4: Replace the placeholder in `GameClient`**

Import and render:

```tsx
<ProgressSummaryPanel
  messages={snapshot.messages}
  summary={snapshot.progressSummary}
/>
```

Use `snapshot.messages`, not optimistic `visibleMessages`, because pending local submissions must not count toward judged-summary cadence.

- [ ] **Step 5: Add focused CSS**

Add classes for summary meta/status/category/list spacing while reusing `.sidebar-card`, `.eyebrow`, `.muted`, existing colors, and existing responsive sidebar behavior.

Do not change dashboard width, sidebar width, breakpoints, or unrelated card styles.

- [ ] **Step 6: Extend GameClient integration test**

Assert the placeholder text `即将加入` is gone and a supplied READY snapshot renders summary content in the right sidebar.

- [ ] **Step 7: Run web suite**

```bash
pnpm --filter @turtle-soup/web test
pnpm --filter @turtle-soup/web typecheck
pnpm --filter @turtle-soup/web lint
pnpm --filter @turtle-soup/web build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/game/progress-summary-panel* apps/web/src/components/game/game-client* apps/web/src/app/globals.css
git commit -m "feat: show current game progress summary"
```

---

### Task 9: Add acceptance/regression coverage and run the phase gate

**Files:**
- Modify: existing Worker acceptance/fake-judge verification files where the first-playable loop is exercised.
- Modify: `scripts/verify-first-playable-loop.mjs` only if its current architecture is the repository’s canonical cross-package acceptance entrypoint.
- Modify: `package.json` only if a dedicated progress-summary verification script materially reduces repeated manual commands.
- Do not add a production live-model benchmark as a required deploy gate.

- [ ] **Step 1: Extend Fake-Judge acceptance**

Use deterministic fake summary output and drive at least these scenarios:

1. first 9 questions judged → no summary job/public summary;
2. 10th question → summary job → READY public summary;
3. 11th–19th → summary remains through 10;
4. 20th → summarizer receives all first 20 current public question/verdict pairs;
5. challenge changes question <=20 → same boundary refreshes with revised verdict;
6. challenge changes question > published boundary → no old-boundary refresh;
7. forced model failure/retries → last good summary remains and safe ERROR appears after block;
8. no score/discovered-count/message-verdict changes are caused by summary completion.

- [ ] **Step 2: Add a prompt regression fixture for leakage**

Use a fixture where the hidden solution contains facts never asked by players. Assert the `ProgressSummaryInput` and constructed prompt contain none of those hidden-only facts because the processor never loads them.

This should be deterministic and should not depend on a live model matching wording.

- [ ] **Step 3: Run focused database + package verification**

```bash
pnpm exec supabase db reset
pnpm exec supabase test db
pnpm --filter @turtle-soup/contracts test
pnpm --filter @turtle-soup/game-core test
pnpm --filter @turtle-soup/judge-worker test
pnpm --filter @turtle-soup/web test
```

Expected: all PASS.

- [ ] **Step 4: Run full repository gates**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm verify:first-playable-loop
git diff --check
```

Also build the Worker Docker image using the repository’s existing Docker workflow if that is part of the current release gate.

- [ ] **Step 5: Security review before final commit**

Confirm from SQL grants/policies and application queries:

- anon/authenticated can read only safe summary text/status;
- `game_web` cannot read or write private summary jobs;
- the summary processor never queries `private.game_secrets`, `private.key_points`, `private.key_point_evidence`, claims, or scores;
- public summary rows contain no provider/model/error-code information;
- `private.judge_attempts` remains inaccessible to browser roles.

- [ ] **Step 6: Review staged diff**

```bash
git status --short
git diff --cached --stat
git diff --cached --check
```

Remove any generated/unrelated Next artifacts not required by `apps/web/AGENTS.md`. If Next regenerates an agent file that the repo explicitly tracks, follow that file’s own instruction instead of deleting it blindly.

- [ ] **Step 7: Final commit**

```bash
git add scripts package.json packages services apps supabase
# Stage only files actually changed by this feature.
git commit -m "test: verify progress summary flow"
```

---

## Final verification matrix

| Area | Required command / assertion |
|---|---|
| Contracts | `pnpm --filter @turtle-soup/contracts test && pnpm --filter @turtle-soup/contracts typecheck` |
| Game core regressions | `pnpm --filter @turtle-soup/game-core test` |
| Worker | `pnpm --filter @turtle-soup/judge-worker test && pnpm --filter @turtle-soup/judge-worker typecheck && pnpm --filter @turtle-soup/judge-worker build` |
| Database | `pnpm exec supabase db reset && pnpm exec supabase test db` |
| Web | `pnpm --filter @turtle-soup/web test && pnpm --filter @turtle-soup/web typecheck && pnpm --filter @turtle-soup/web lint && pnpm --filter @turtle-soup/web build` |
| Acceptance | `pnpm verify:first-playable-loop` with summary scenario added |
| Repository | `pnpm test && pnpm typecheck && pnpm lint && pnpm build && git diff --check` |
| Security | No private solution/KP/Evidence/claim/score query in summary processor; no browser access to private queue/audit |
| UI | Right sidebar “当前进度” replaces `即将加入`, keeps last good summary during PENDING/ERROR, and updates via Realtime |

## Explicit non-goals for Codex

- Do not redesign the judge verdict prompt while implementing the summary prompt.
- Do not make the summary model decide key-point completion or scoring.
- Do not expose hidden Evidence as a richer source for the summary, even though it may seem semantically useful.
- Do not summarize from the previous AI summary; always rebuild from public judged questions through the fixed boundary.
- Do not add a new Vercel route just to generate summaries.
- Do not introduce Redis, cron, a second deployed Worker, or a new queue service for V1.
- Do not add summary history UI.
- Do not add manual retry/admin controls for summary jobs in V1.
- Do not attempt unrelated cleanup of `game-client.tsx`, the root ESLint setup, or existing migration style.

## Codex execution handoff

When this plan is handed to Codex, use this instruction:

```text
Implement the approved design and execution plan:

Spec:
docs/superpowers/specs/2026-08-18-game-progress-summary-design.md

Plan:
docs/superpowers/plans/2026-08-18-game-progress-summary.md

The requirements discussion, repository analysis, architecture decision, and implementation decomposition are already approved.

The code baseline used by the plan is 88382241598da3c6a3d452f6586eac4b03b3bf9a. Planning-doc commits after that baseline are expected. If current code has not materially changed in the files/invariants covered by the plan, do not restart brainstorming or rewrite the implementation plan; execute it task-by-task with TDD.

If code has changed since the baseline, inspect only relevant drift and adapt the minimum necessary details. Stop only for a genuine product/architecture conflict that cannot be resolved from the spec and current repository.

Follow apps/web/AGENTS.md for Next.js work, keep scope narrow, run every verification gate in the plan, and report any deviation from the approved spec.
```
