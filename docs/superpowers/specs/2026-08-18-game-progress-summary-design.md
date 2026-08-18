# Game Progress Summary Design

## Status

Approved feature design for the right-sidebar **“当前进度”** module.

## Repository baseline

- Repository: `CupXX/turtle_soup_online`
- Branch: `main`
- Code baseline: `88382241598da3c6a3d452f6586eac4b03b3bf9a`
- Planning-doc commits after that baseline are documentation-only and do not count as code drift.

If implementation starts from a later code commit, compare only code changes after this baseline that touch the files or invariants named below.

## Goal

Replace the right-sidebar placeholder with a cumulative AI-written progress summary that helps players remember what the group has already established.

The summary updates at every 10 **judged normal questions** and organizes current explored knowledge into three natural-language groups:

1. `YES` → facts currently supported;
2. `NO` → propositions currently ruled out;
3. `IRRELEVANT` → directions/topics currently known to be unrelated.

`BOTH` remains visible in the message feed but does not produce a summary fact in V1.

The Worker must also reconcile an already-running game at startup. If an ACTIVE game already has at least 10 judged questions but lacks the current eligible summary, startup immediately enqueues the most recent 10-question boundary. Example: **41 judged questions → ensure a summary through question 40**.

## Non-goals

- Do not change verdict semantics.
- Do not change key-point extraction, cumulative Evidence, scoring, hit rate, challenge voting, or final-answer behavior.
- Do not count `FINAL_ANSWER` or `CHALLENGE` actions toward the cadence.
- Do not summarize PENDING / ERROR / CANCELLED messages.
- Do not use `full_solution`, private key points, private Evidence, claims, awards, or scores as summary input.
- Do not add manual player/admin editing, history navigation, or per-player summaries.
- Do not generate a special final summary when the game ends.
- Startup reconciliation applies only to the current ACTIVE game; it does not backfill ENDED history.
- A BLOCKED/ERROR summary for the exact same source state is not automatically retried merely because the Worker restarts.

## Existing architecture and constraints

The current UI already reserves the target slot in `apps/web/src/components/game/game-client.tsx`:

```tsx
<section className="sidebar-card progress-placeholder" aria-label="当前进度">
  <p className="eyebrow">当前进度</p>
  <strong>即将加入</strong>
  <p className="muted">这里将展示本局的整体推进状态。</p>
</section>
```

`PublicGameSnapshot` is assembled by `apps/web/src/server/game/get-current-snapshot.ts`; browser Realtime invalidates snapshots when subscribed `api` tables change.

`api.games.total_question_count` increments at receipt time and therefore includes pending questions. It is **not** authoritative for summary cadence. Cadence uses only `api.messages` rows whose current status is `JUDGED`.

The Worker currently has key-point extraction jobs plus the strict ordered `private.game_actions` queue (`NORMAL_MESSAGE`, `FINAL_ANSWER`, `CHALLENGE`). Progress-summary work must remain a separate queue and must not add a fake player action type.

Challenge resolution can change the current verdict of a previously summarized question, so summary jobs need same-boundary regeneration without publishing stale output.

## User-visible behavior

### 0–9 judged questions

The card contains no generated facts.

Example:

- title: `当前进度`
- state: `还在探索中`
- helper: `再完成 7 个问题后整理首次总结`

The countdown is derived from judged public messages.

### Question 10, 20, 30, ...

When judged count reaches a positive multiple of 10, the Worker ensures a summary job for that boundary.

A summary through question N always rebuilds from the first N **current judged public questions** in sequence order. It does not use only the newest ten and never recursively summarizes an earlier AI summary.

Example model output:

```json
{
  "confirmed_facts": ["男人杀死了自己的妻子。"],
  "ruled_out_facts": ["这不是一起自杀。"],
  "irrelevant_topics": ["天气因素与事件无关。"]
}
```

The sidebar renders short natural-language groups and omits empty categories.

### Startup reconciliation / backfill

On every Worker process startup, after the initial heartbeat and before the normal work loop, run one reconciliation pass:

1. Find the current ACTIVE game. If none exists, no-op.
2. Read its `JUDGED` messages in sequence order.
3. Compute:

```text
judgedCount = number of JUDGED messages
latestBoundary = floor(judgedCount / 10) * 10
```

4. If `latestBoundary < 10`, no-op.
5. Use the Nth judged message (`N = latestBoundary`) as `through_sequence_no`.
6. Build the canonical public input for exactly the first N judged messages and calculate its `source_fingerprint`.
7. Ensure a job exists for `(game_id, latestBoundary, source_fingerprint)` unless the public summary already represents that exact source state.

Examples:

- 9 judged → no backfill.
- 10 judged, no summary/job → enqueue 10.
- 19 judged, no summary/job → enqueue 10.
- 41 judged, no summary → enqueue 40.
- summary READY through 30, 41 judged → enqueue 40.
- summary READY through 40 with matching fingerprint, 41 judged → no-op.
- same 40-boundary source already PENDING/PROCESSING/RETRY → no duplicate.
- same 40-boundary source already BLOCKED and public status is ERROR → do not silently create a fifth attempt on restart.

This startup pass is deliberately **reconciliation**, not “retry everything”. It repairs missing work caused by deploying the feature into an already-running game or by a process stopping before a boundary was scheduled, while preserving the existing retry ceiling.

The operation must be safe if multiple Worker processes start: database uniqueness/idempotency determines the winner and all other attempts become no-ops.

### Pending refresh

If no prior successful summary exists, show `正在整理当前进度…`.

If an older READY summary exists, keep its facts visible while the newer target is PENDING and show `正在更新…` / `正在更新到第 N 问`.

### Failed refresh

After retries are exhausted, keep the last READY facts visible and expose only a safe ERROR state such as `本轮总结暂时未更新`.

Do not expose queue IDs, provider/model names, retry counts, error codes, or stack traces.

A future new boundary (for example 50 after a blocked 40) may enqueue normally and recover.

## Summary semantics and safety boundary

### Model input

The summarizer receives only:

```ts
export type ProgressSummarySourceItem = {
  sequence_no: number;
  question: string;
  verdict: JudgeVerdict;
};

export type ProgressSummaryInput = {
  questions: ProgressSummarySourceItem[];
};
```

Source rows come from current public state (`api.messages`) and are fixed to the job boundary.

The summarizer must never receive:

- `private.game_secrets.full_solution`
- `private.key_points`
- `private.key_point_evidence`
- `private.question_judgments` coverage/evidence arrays
- `private.key_point_claims`
- player scores or awarded points

This makes the summarizer a compression layer over already-public knowledge, not a second puzzle solver.

### YES

Convert the proposition actually established by the question/verdict into a concise confirmed fact. Handle grammatical negation correctly.

### NO

Convert the proposition into a concise ruled-out fact. Handle already-negative questions correctly instead of mechanically adding another negation.

### IRRELEVANT

Only summarize the broad direction as unrelated.

Example:

- `天气重要吗？` + IRRELEVANT → `天气因素与事件无关。`
- Must not infer `当时天气晴朗。`

### BOTH

The source row may be supplied for ordering/context, but V1 output arrays must not create facts from BOTH.

### Compression

The model should merge repeated/overlapping public discoveries. It must not invent new motive, cause, identity, chronology, relation, or outcome that cannot be reconstructed from the supplied judged questions.

Each category contains 0–4 unique concise strings, each 1–120 characters.

## Canonical source fingerprint

Same-boundary refreshes require distinguishing old and new public verdict state. Each summary job therefore stores a deterministic `source_fingerprint`.

Build it from the exact fixed input array in sequence order. The canonical data is equivalent to:

```ts
JSON.stringify(
  questions.map(({ sequence_no, question, verdict }) => [sequence_no, question, verdict]),
)
```

Hash with SHA-256 and store the lowercase hex digest (64 characters).

The fingerprint is not a security secret. It is an idempotency/staleness token.

Consequences:

- two scheduling attempts for the same boundary and unchanged public judgments converge on one job;
- a challenge that changes a verdict inside the boundary creates a different fingerprint and therefore a new refresh job;
- a challenge that leaves the public verdict unchanged does not create duplicate work;
- startup reconciliation can tell whether the current READY/ERROR state matches the current source;
- stale model output can be rejected before publication.

## Contracts

In `packages/contracts/src/game.ts` add:

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
```

`throughQuestionCount` / `throughSequenceNo` describe the last successfully published content. `targetQuestionCount` describes a newer PENDING/ERROR target and may be null when no newer target exists.

Extend `PublicGameSnapshot` with:

```ts
progressSummary: PublicGameProgressSummary | null;
```

In `packages/contracts/src/judge.ts` add:

```ts
export type ProgressSummaryResult = {
  confirmed_facts: string[];
  ruled_out_facts: string[];
  irrelevant_topics: string[];
};
```

Extend `SemanticJudge`:

```ts
summarizeProgress(input: ProgressSummaryInput): Promise<ProgressSummaryResult>;
```

## Database design

### `api.game_progress_summaries`

One safe public current-state row per game:

```text
game_id                       uuid primary key -> api.games(id) on delete cascade
through_question_count        integer not null default 0
through_sequence_no           bigint not null default 0
source_fingerprint            text null
confirmed_facts               text[] not null default '{}'
ruled_out_facts                text[] not null default '{}'
irrelevant_topics             text[] not null default '{}'
generation_status             text not null check PENDING | READY | ERROR
target_question_count         integer null
target_sequence_no            bigint null
target_source_fingerprint     text null
generated_at                   timestamptz null
updated_at                     timestamptz not null default now()
```

Rules:

- successful published boundaries are 0 or positive multiples of 10;
- a READY successful summary has `through_question_count >= 10`, a source fingerprint, and `generated_at`;
- PENDING/ERROR may retain older successful content while target columns identify the attempted newer/current source;
- source/target fingerprints, counts, and status are safe public metadata; queue/error internals remain private.

Permissions:

- `anon`, `authenticated`: SELECT only
- `game_web`: SELECT only
- `judge_worker`: SELECT/INSERT/UPDATE
- force RLS
- add to `supabase_realtime`

### `private.progress_summary_jobs`

```text
id                      uuid primary key
game_id                 uuid not null -> api.games(id) on delete cascade
through_question_count  integer not null
through_sequence_no     bigint not null
source_fingerprint      text not null
status                  text not null
attempt_count           integer not null default 0
next_attempt_at         timestamptz not null default now()
lease_owner             text null
lease_expires_at        timestamptz null
error_code              text null
created_at              timestamptz not null default now()
updated_at              timestamptz not null default now()
```

Statuses:

`PENDING | PROCESSING | RETRY | BLOCKED | COMPLETED | STALE | CANCELLED`

Use a unique constraint/index on:

```text
(game_id, through_question_count, source_fingerprint)
```

This uniqueness is intentionally across all statuses. A BLOCKED job for the same exact source cannot be recreated by Worker restart; a changed source gets a new fingerprint and can enqueue.

No browser/game_web access. `judge_worker` gets only the narrow queue privileges/policies it needs.

### Judge audit

Extend `private.judge_attempts` with nullable `progress_summary_job_id` and change the parent constraint so exactly one of:

- `action_id`
- `extraction_job_id`
- `progress_summary_job_id`

is non-null.

## Shared scheduling helper

Create one repository-level Worker DB helper that all three trigger paths use, conceptually:

```ts
ensureProgressSummaryJobForBoundary(
  sql,
  gameId,
  throughQuestionCount,
): Promise<EnsureProgressSummaryResult>
```

Responsibilities:

1. verify boundary is >=10 and divisible by 10;
2. load exactly the first N current JUDGED messages in sequence order;
3. derive Nth message `throughSequenceNo`;
4. compute canonical `sourceFingerprint`;
5. if `api.game_progress_summaries.source_fingerprint` already equals the target fingerprint at the same boundary and is READY, no-op;
6. if a job already exists with `(game, boundary, fingerprint)` in any status, do not insert another;
7. otherwise insert a PENDING job;
8. set/refresh public target metadata and PENDING status without deleting older successful facts.

This helper is the idempotency point for normal boundaries, challenge refresh, and startup reconciliation.

## Trigger rules

### Normal question completion

After a question has become JUDGED inside `completeQuestion()`:

1. count current JUDGED messages for the game;
2. only when `count % 10 === 0`, call the shared ensure helper with `count`;
3. do not use receipt count;
4. do not change scoring if scheduling fails due to an already-existing job.

### Challenge refresh

After a challenge has resolved and the **public verdict actually changed**:

1. calculate the latest eligible boundary `floor(judgedCount / 10) * 10`;
2. if boundary < 10, no-op;
3. determine whether the challenged message is among the first N judged messages for that boundary;
4. if not, no-op;
5. if yes, call the same ensure helper for N.

The new fingerprint makes a changed same-boundary verdict a new job. If the challenge outcome leaves the current verdict unchanged, no summary refresh is scheduled.

### Worker startup reconciliation

Add a startup hook in the Worker lifecycle. Required order:

```text
initial heartbeat
→ reconcile current ACTIVE game summary
→ enter normal extraction/action/summary loop
```

The reconciliation helper:

```ts
reconcileActiveGameProgressSummary(sql): Promise<void>
```

must:

1. read at most the current ACTIVE game;
2. count/order current JUDGED messages;
3. compute latestBoundary = floor(count / 10) * 10;
4. no-op below 10;
5. call `ensureProgressSummaryJobForBoundary(sql, gameId, latestBoundary)`.

Do not clear or reset a BLOCKED job. Because the shared ensure helper checks the all-status unique key, restarting the Worker cannot bypass the retry ceiling.

Startup reconciliation failure should be logged/fail startup only for genuine database/programming errors. A normal idempotent no-op is not an error.

## Worker queue and processing

Add progress-summary as a separate queue type, not a game action.

Reuse existing lease/retry timings: 2s, 5s, 15s; block after four attempts.

A processor:

1. loads exactly the fixed first N judged public messages;
2. recomputes the fingerprint and verifies it equals the job fingerprint;
3. if the input has already changed, mark the job STALE and ensure a replacement for the same boundary/current source; do not call/publish stale output;
4. call `judge.summarizeProgress()` outside a transaction;
5. on completion, reacquire a short transaction, re-read the fixed source and recheck fingerprint;
6. if changed while the model was running, mark STALE and ensure replacement;
7. otherwise publish the result atomically, advance successful boundary/source fields, clear target fields, set READY, and mark job COMPLETED.

If retries exhaust, mark job BLOCKED and set public ERROR only if its target fingerprint is still the current target. Preserve older successful facts.

## AI skill and config

Add `progress-summary` as a fourth `HarnessSkill`.

Prompt version: `progress-summary-v1`.

Add optional overrides with `JUDGE_MODEL` fallback:

```text
JUDGE_PROGRESS_SUMMARY_MODEL
JUDGE_PROGRESS_SUMMARY_REASONING_EFFORT
```

Strict output schema:

- object only
- required arrays: `confirmed_facts`, `ruled_out_facts`, `irrelevant_topics`
- max 4 items per array
- each string 1–120 chars
- no extra properties
- reject normalized exact duplicates inside a category

Audit through the existing best-effort `judge_attempts` flow; audit failure must never alter summary behavior.

## Snapshot, Realtime, and UI

`getCurrentSnapshot()` includes `progressSummary` from `api.game_progress_summaries`.

`createRealtimeSubscribe()` subscribes to this table by `game_id`.

Create `ProgressSummaryPanel` rather than growing `GameClient` further:

```ts
type ProgressSummaryPanelProps = {
  messages: PublicMessage[];
  summary: PublicGameProgressSummary | null;
};
```

UI states:

- `<10 judged`, no summary: `还在探索中` + countdown.
- no successful facts + PENDING: `正在整理当前进度…`.
- READY: show `整理至第 N 问`, category groups, countdown to next boundary.
- old READY facts + newer PENDING: keep old facts and show `正在更新到第 N 问…`.
- old facts + ERROR: keep old facts and show `本轮总结暂时未更新`.
- no successful facts + ERROR: safe failure copy, no technical details.

Do not show hidden KP progress in this card. The existing discovered-key-point mechanics remain separate.

## Key acceptance cases

1. Judged counts 1–9 create no job.
2. The 10th judged question creates exactly one boundary-10 job.
3. Pending receipt count reaching 10 does not trigger until the 10th question is JUDGED.
4. Question 20 creates boundary 20 and cumulative input contains questions 1–20.
5. BOTH rows produce no summary fact.
6. A challenge changing question 7 after boundary 10 produces a new fingerprint and refresh job for boundary 10.
7. A challenge changing question 14 while current eligible boundary is 10 does not refresh 10.
8. Changed source during model execution cannot publish stale output.
9. Worker startup with 41 judged questions and no summary ensures boundary 40.
10. Worker startup with READY matching boundary 40 does nothing.
11. Worker startup with an existing PENDING/PROCESSING/RETRY boundary-40 job does not duplicate it.
12. Worker startup with a BLOCKED job for the exact boundary/fingerprint does not recreate it.
13. Two startup reconciliations racing produce one job because of the unique key.
14. Summary model input contains public question text/current verdict only and no private solution/KP/Evidence data.
15. Realtime READY transition replaces the placeholder in the right-sidebar “当前进度” card.

## Verification standard

Implementation is complete only after focused TDD plus:

```bash
pnpm exec supabase db reset
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Also run the local acceptance path extended to cover boundary-10 generation and startup backfill (41 → 40).