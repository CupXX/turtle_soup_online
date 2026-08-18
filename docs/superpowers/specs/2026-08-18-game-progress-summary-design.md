# Game Progress Summary Design

## Status

Approved feature design for the right-sidebar **“当前进度”** module.

## Repository baseline

- Repository: `CupXX/turtle_soup_online`
- Branch: `main`
- Code baseline: `88382241598da3c6a3d452f6586eac4b03b3bf9a`
- Planning-doc commits added after this baseline do not count as code drift.

If implementation starts from a later code commit, compare only code changes after this baseline that touch the files or invariants named below.

## Goal

Replace the current right-sidebar placeholder with a cumulative, AI-written progress summary that helps players remember what the group has already established.

The summary updates after every 10 **judged normal questions** and organizes explored information into natural-language facts in three categories:

1. facts currently supported by YES judgments;
2. propositions currently ruled out by NO judgments;
3. topics currently judged IRRELEVANT.

The feature must never reveal solution-only information, hidden key points, or hidden Evidence. It summarizes only information that is already recoverable from public question text plus the current public verdict.

## Non-goals

- Do not change YES / NO / BOTH / IRRELEVANT semantics.
- Do not change key-point extraction, Evidence discovery, scoring, hit rate, or final-answer behavior.
- Do not count `FINAL_ANSWER` or `CHALLENGE` actions toward the 10-question cadence.
- Do not summarize unjudged `PENDING` messages.
- Do not use `full_solution`, private key points, private Evidence, key-point claims, or award data as summary input.
- Do not add manual player editing, admin editing, summary history navigation, or per-player summaries.
- Do not generate a special final summary when the game ends.
- V1 does not convert `BOTH` into a progress fact. BOTH questions remain visible in the message feed but are omitted from the generated progress summary because forcing them into positive/negative categories risks overstating ambiguous information.

## Existing architecture and constraints

The current game client already reserves the location for this feature in `apps/web/src/components/game/game-client.tsx`:

```tsx
<section className="sidebar-card progress-placeholder" aria-label="当前进度">
  <p className="eyebrow">当前进度</p>
  <strong>即将加入</strong>
  <p className="muted">这里将展示本局的整体推进状态。</p>
</section>
```

`PublicGameSnapshot` currently contains game, players, messages, events, stats, and reveal. `getCurrentSnapshot()` assembles that snapshot on the server, and browser Realtime invalidates the snapshot when selected `api` tables change.

Normal-question receipt increments `api.games.total_question_count` when a question is submitted. That field is **not** the summary trigger because it includes questions that may still be pending. Summary cadence is based on the number of `api.messages` rows that have reached `status = 'JUDGED'`.

The serial Worker currently processes key-point extraction jobs and game actions. Game actions are a strict ordered queue for `NORMAL_MESSAGE`, `FINAL_ANSWER`, and `CHALLENGE`; summary work must not be represented as a fake player action or alter that action-type contract.

Challenge resolution updates the current public verdict and can rebuild key-point progress. Because a challenge can change a verdict already represented in a published summary, the summary layer must support refreshing an existing 10-question boundary.

## User-visible behavior

### Before the first summary

For 0–9 judged questions, the “当前进度” card shows no AI-generated facts. It shows lightweight progress copy such as:

- title: `当前进度`
- state: `还在探索中`
- helper: `再完成 7 个问题后整理首次总结`

The countdown is derived from the number of currently judged messages, not submitted questions.

### At question 10, 20, 30, ...

When the Nth judged normal question completes and `N % 10 === 0`, the Worker schedules a cumulative summary through question N.

The summary uses all judged normal questions from the start of the game through that boundary, in message sequence order. It does **not** summarize only the newest batch of ten and does not recursively summarize a previous AI summary. Rebuilding from the public judgments prevents error accumulation.

Example output shape:

```json
{
  "confirmed_facts": [
    "死者的死亡与她扔出去的物体有关。"
  ],
  "ruled_out_facts": [
    "这不是一起自杀。"
  ],
  "irrelevant_topics": [
    "天气与事件原因无关。"
  ]
}
```

The UI renders these as short natural-language groups, not as copied question/verdict pairs. Empty categories are omitted.

The card also shows `整理至第 N 问` and, when READY, `再完成 X 个问题后更新`.

### While a refresh is pending

If there is no previous successful summary, show `正在整理当前进度…`.

If an older successful summary exists, keep it visible and add a muted `正在更新…` status. Do not blank the last known-good summary while a new one is generated.

### If generation fails after retries

Keep the last successful summary. Set a safe public state to ERROR and show muted copy such as `本轮总结暂时未更新`.

Do not expose provider names, model errors, retry counts, stack traces, queue IDs, or error codes to the browser.

The next 10-question boundary must still be able to enqueue a fresh summary and recover automatically.

## Summary semantics

### Input boundary

The summarizer receives only rows equivalent to:

```ts
type ProgressSummarySourceItem = {
  sequence_no: number;
  question: string;
  verdict: 'YES' | 'NO' | 'BOTH' | 'IRRELEVANT';
};
```

The Worker loads these from public/current state (`api.messages`) through the job’s fixed `through_sequence_no` boundary.

The Worker must verify that the number of JUDGED normal messages through that boundary equals the job’s `through_question_count`. A mismatch means the job input is stale/invalid and must not publish a summary.

### No private-ground-truth input

The summarizer must not receive:

- `private.game_secrets.full_solution`
- `private.key_points`
- `private.key_point_evidence`
- `private.question_judgments` coverage arrays
- key-point claims or scores

This is an intentional security boundary. The model is being asked to condense already-public discoveries, not to solve the puzzle.

### YES

A YES judgment may be turned into a concise confirmed fact, preserving the proposition actually asked by the player. The model must correctly handle natural-language negation rather than assuming YES always produces a grammatically positive sentence.

### NO

A NO judgment may be turned into a concise ruled-out fact. The model must negate the actual proposition asked by the player and must correctly handle questions that are already grammatically negative.

### IRRELEVANT

IRRELEVANT may only be summarized as a broad topic/direction being unrelated. It must not be converted into a hidden positive or negative story fact.

Example:

- question: `天气重要吗？`
- verdict: `IRRELEVANT`
- acceptable: `天气因素与事件无关。`
- unacceptable: `当时天气晴朗。`

### BOTH

BOTH rows are supplied only for context ordering if useful to the prompt, but V1 output must not create facts from them. The prompt explicitly instructs the model to ignore BOTH when producing the three output arrays.

### Compression and duplication

The model should merge repeated or near-duplicate discoveries and prefer the most informative formulation supported by the public judgments.

It must not:

- repeat every question individually;
- invent motives, causes, identities, chronology, or causal links not established by the judged questions;
- complete a partially discovered key point using model knowledge;
- use the private puzzle answer, because it is not supplied;
- mention “YES / NO / IRRELEVANT” tokens in the player-facing wording.

Each output category contains 0–4 items. Each item is a single concise natural-language sentence with a maximum length of 120 characters. The complete card therefore remains usable in the 290px sidebar.

## Contracts

Add the following public contract types in `packages/contracts/src/game.ts`:

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
```

Extend `PublicGameSnapshot`:

```ts
export type PublicGameSnapshot = {
  game: PublicGame;
  players: PublicPlayer[];
  messages: PublicMessage[];
  events: PublicGameEvent[];
  stats: PublicPlayerStats[];
  progressSummary: PublicGameProgressSummary | null;
  reveal: PublicGameReveal | null;
};
```

Add AI contracts in `packages/contracts/src/judge.ts`:

```ts
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

Extend `SemanticJudge` with:

```ts
summarizeProgress(input: ProgressSummaryInput): Promise<ProgressSummaryResult>;
```

## Database design

### Public current-summary table

Create `api.game_progress_summaries` with one current public state row per game:

```text
game_id                 uuid primary key -> api.games(id) on delete cascade
through_question_count  integer not null default 0
through_sequence_no     bigint not null default 0
confirmed_facts         text[] not null default '{}'
ruled_out_facts          text[] not null default '{}'
irrelevant_topics       text[] not null default '{}'
generation_status       text not null check PENDING | READY | ERROR
generated_at             timestamptz null
updated_at               timestamptz not null default now()
```

Constraints:

- `through_question_count >= 0`
- `through_sequence_no >= 0`
- a READY row must have `through_question_count >= 10` and divisible by 10
- the table contains only safe player-visible text and safe status metadata

Permissions follow existing public tables:

- `anon`, `authenticated`: SELECT only
- `game_web`: SELECT only
- `judge_worker`: SELECT, INSERT, UPDATE
- RLS forced
- public read policy for anon/authenticated
- narrow game_web/worker policies matching these privileges
- add `api.game_progress_summaries` to `supabase_realtime`

### Private summary-job queue

Create `private.progress_summary_jobs`:

```text
id                      uuid primary key
game_id                 uuid not null -> api.games(id) on delete cascade
through_question_count  integer not null
through_sequence_no     bigint not null
status                  text not null
attempt_count           integer not null default 0
next_attempt_at         timestamptz not null default now()
lease_owner             text null
lease_expires_at        timestamptz null
error_code              text null
created_at              timestamptz not null default now()
updated_at              timestamptz not null default now()
```

Allowed job statuses mirror existing queue conventions:

`PENDING | PROCESSING | RETRY | BLOCKED | COMPLETED | CANCELLED`

Constraints:

- `through_question_count >= 10`
- `through_question_count % 10 = 0`
- `through_sequence_no > 0`
- `attempt_count >= 0`

Add a partial unique index preventing duplicate active jobs for the exact same `(game_id, through_question_count, through_sequence_no)` when status is `PENDING`, `PROCESSING`, or `RETRY`.

Permissions:

- no browser access
- no anon/authenticated access
- no game_web access
- `judge_worker`: SELECT, INSERT, UPDATE
- forced RLS with judge_worker-only policies

This preserves the current separation where browser-facing routes cannot lease Worker jobs.

## Scheduling rules

### Normal-question completion

After `completeQuestion()` has successfully committed the current judgment state for the message, use the current count of `api.messages where game_id = ? and status = 'JUDGED'`.

If the count is a positive multiple of 10:

1. enqueue a summary job with `through_question_count = judgedCount`;
2. set `through_sequence_no` to the just-completed message sequence;
3. cancel older PENDING/RETRY summary jobs for the same game and smaller boundaries;
4. upsert `api.game_progress_summaries.generation_status = 'PENDING'` while preserving any previous READY content and metadata.

The queue operation must be idempotent so an exact-once question completion or retry cannot create duplicate active jobs.

### Challenge refresh

After a challenge resolves, only schedule a summary refresh when all of these are true:

1. the resolved public verdict differs from the previous current verdict;
2. a public progress-summary row exists for the game;
3. the challenged message `sequence_no <= progressSummary.through_sequence_no`;
4. `progressSummary.through_question_count >= 10`.

The refresh job reuses the currently published boundary (`through_question_count` and `through_sequence_no`). It regenerates the whole summary from current public verdicts through that boundary.

A challenge for a question after the published boundary does not trigger a refresh because that question has not yet been summarized.

## Worker behavior

Add a third queue type for progress-summary jobs. Do not add `PROGRESS_SUMMARY` to `private.game_actions.action_type`.

The main Worker loop may process summary work serially with existing AI work. Summary work should be checked before the next normal game action once a summary job is ready. This can add one summarization call after each 10-question boundary, but avoids a second deployment/runtime in V1.

Existing retry policy (2s, 5s, 15s; block after four attempts) should be reused for transport/timeout/schema errors.

A summary job processor:

1. loads the fixed public input boundary;
2. verifies the boundary contains exactly `through_question_count` judged questions;
3. calls `judge.summarizeProgress()` outside a transaction;
4. validates structured output;
5. completes with a short transaction that verifies the job lease, stores the public summary, sets READY, and marks the job COMPLETED.

If retries are exhausted, mark the job BLOCKED and set the public row to ERROR only when that blocked job still represents the newest requested boundary/state.

## AI skill

Add `progress-summary` as a fourth `HarnessSkill`.

Prompt version: `progress-summary-v1`.

Schema version remains `judge-schema-v1` because the result is a new skill, not a backward-compatible variant of question judging.

Add independent config overrides while preserving `JUDGE_MODEL` fallback:

```text
JUDGE_PROGRESS_SUMMARY_MODEL
JUDGE_PROGRESS_SUMMARY_REASONING_EFFORT
```

The default can use the same model and `off` reasoning as other skills unless the environment overrides it.

The JSON schema is strict:

- object only
- required: `confirmed_facts`, `ruled_out_facts`, `irrelevant_topics`
- each property is an array
- maximum 4 items each
- each item string length 1–120
- no additional properties

Validation should also reject exact duplicate normalized strings within the same category.

## Audit behavior

Progress-summary AI calls should use the same best-effort `private.judge_attempts` audit pattern as existing skills.

Extend `private.judge_attempts` so a row may reference `progress_summary_job_id`, and extend the existing parent union so exactly one parent source is selected among action, extraction job, and progress-summary job.

Audit failure must never alter summary correctness or retry behavior, matching the existing best-effort audit invariant.

## Snapshot and Realtime

`getCurrentSnapshot()` reads at most one row from `api.game_progress_summaries` for the current game and returns it as `progressSummary`.

`createRealtimeSubscribe()` subscribes to changes on `api.game_progress_summaries` filtered by `game_id` so PENDING / READY / ERROR transitions refresh the public snapshot automatically.

The current `api.games`, messages, events, and stats subscriptions remain unchanged.

## UI design

Create a focused `ProgressSummaryPanel` component instead of expanding `GameClient` further.

Inputs:

```ts
type ProgressSummaryPanelProps = {
  messages: PublicMessage[];
  summary: PublicGameProgressSummary | null;
};
```

The component computes `judgedQuestionCount` from `messages.filter(message => message.status === 'JUDGED')`.

States:

1. `< 10` judged, no summary: countdown to first summary.
2. summary PENDING, no previous content: `正在整理当前进度…`.
3. summary READY: show categories and next-boundary countdown.
4. summary PENDING with previous content: show previous content plus `正在更新…`.
5. summary ERROR with previous content: show previous content plus `本轮总结暂时未更新`.
6. summary ERROR without content: show `当前进度暂时无法整理`.

READY rendering:

- eyebrow: `当前进度`
- meta: `整理至第 {throughQuestionCount} 问`
- confirmed: `目前可以确定`
- ruled out: `已经排除`
- irrelevant: `无关方向`

Only render category headings that contain at least one sentence.

Use the existing sidebar-card visual language. Add only focused CSS for summary spacing/list typography/status; do not redesign the dashboard.

On mobile, the existing sidebar one-column breakpoint should continue to work without new layout rules.

## Error handling and consistency

- Summary failure must never roll back a completed question or challenge.
- A summary job must never award points or change game/key-point progress.
- A stale/invalid input boundary must never publish a result.
- Repeated enqueue requests for the same active boundary must be idempotent.
- The previous successful summary remains visible until a newer summary successfully completes.
- Games created before this migration require no backfill; they simply have `progressSummary = null` until a qualifying boundary is reached after deployment.
- ENDED games continue returning the last summary row if one exists, while the reveal remains the authoritative final answer display.

## Acceptance criteria

1. At 9 judged questions, no AI summary exists and the sidebar shows one question remaining.
2. The 10th judged normal question enqueues exactly one summary job.
3. `FINAL_ANSWER` and `CHALLENGE` actions do not increment the summary cadence.
4. The summary model input contains question text, sequence, and current verdict only; it contains no full solution, key-point text, Evidence text, claims, or scores.
5. A successful 10-question job publishes a READY summary and updates the right-side “当前进度” card over Realtime.
6. At question 20, the model receives the cumulative first 20 judged questions, not the previous AI summary plus ten new questions.
7. YES, NO, and IRRELEVANT can produce natural-language output in the expected category; BOTH produces no player-facing fact.
8. Duplicate/repeated questions are compressed instead of repeated verbatim.
9. A challenge that changes the verdict of a question already inside the current published boundary schedules a refresh of that boundary.
10. A challenge on a question after the published boundary does not refresh the old summary.
11. A summary failure leaves gameplay, scoring, verdicts, and the last good summary unchanged.
12. Exhausted retries set a safe ERROR state without exposing provider/debug information.
13. The browser has no access to `private.progress_summary_jobs` or hidden puzzle data.
14. Existing normal-question, cumulative Evidence, challenge, final-answer, and scoring regressions continue to pass.
15. Web implementation obeys `apps/web/AGENTS.md`: before changing Next.js-specific code, Codex must read the relevant local Next 16.3.1 docs under `apps/web/node_modules/next/dist/docs/` rather than assuming older Next APIs.
