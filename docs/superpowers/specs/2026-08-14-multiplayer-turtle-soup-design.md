# Multiplayer AI-Native Turtle Soup Game Design

**Status:** Approved design for implementation planning

**Date:** 2026-08-14

**Target MVP concurrency:** At most 10 simultaneous players

## 1. Product Summary

Build one shared multiplayer Turtle Soup / Situation Puzzle game. The site has
one current game and no rooms. Players join with a nickname, submit normal
messages to a shared stream, and may separately submit a private final answer.

The LLM is a backend semantic classifier. It never produces player-facing free
text and never controls authorization, ordering, scoring, key-point ownership,
game state, or visible reactions. Application code maps strict verdict enums to
deterministic UI.

Visible verdict mapping:

| Verdict | Reaction |
|---|---|
| `YES` | ✅ |
| `NO` | ❌ |
| `BOTH` | ❓ |
| `IRRELEVANT` | 👎 |

Scoring:

- First discovery of one fixed key point through a normal message: +1 lifetime
  score.
- Successful final answer: +2 lifetime score.
- Key points first expressed in a final answer do not earn +1.
- There is no separate current-game score.

## 2. Scope

### 2.1 Included

- One global current game.
- Nickname-only players with persistent lifetime score.
- Nickname plus server-side admin secret for administration.
- Manual puzzle surface and solution entry.
- LLM extraction of exactly 3-5 frozen key points before activation.
- One shared normal-message stream.
- Strictly ordered semantic judging.
- Atomic first-hit key-point scoring.
- Private final-answer submissions.
- Supabase persistence and Realtime synchronization.
- Next.js frontend deployable to Vercel.
- Dockerized, cloud-neutral long-running Judge Worker using DeepSeek Harness.
- Provider/model benchmark fixtures.
- Responsive desktop and mobile game UI.
- Non-functional Challenge button with fixed placeholder copy.

### 2.2 Excluded

- Rooms, room codes, matchmaking, or multiple simultaneous games.
- Puzzle generation, search, import, library, history management, or random
  selection.
- Email/password accounts, OAuth, magic links, or secure player identity.
- Separate chat and question modes.
- Turn-taking or player rounds.
- AI hints, summaries, conversational replies, or proactive behavior.
- Functional challenge/rejudge behavior.
- QQ or WeChat integration.
- Elaborate admin dashboard.
- Local LLM inference.

## 3. Explicit MVP Decisions

- The repository starts empty and requires no compatibility layer.
- Peak simultaneous player count is at most 10.
- Supabase Postgres Changes is used for Realtime invalidation. Broadcast, Redis,
  and a separate messaging system are unnecessary for this scale.
- Nicknames use `trim`, Unicode NFKC normalization, and case-insensitive English
  comparison. Display spelling is preserved from the first creation.
- Re-entering the same normalized nickname grants the same player identity. The
  resulting impersonation risk is knowingly accepted.
- Final-answer text has no read API after submission. This prevents a later
  same-nickname impersonator from retrieving it.
- Normal messages and final answers share one server-ordered action sequence.
- The semantic judge is not told which key points are already discovered. It
  reports all fully covered key points; server code determines first ownership.
- The LLM never returns an authoritative final-answer `success` value. It
  returns covered key-point IDs, and server code computes success.
- A valid WAITING game does not expose its puzzle surface. The surface becomes
  public atomically with activation.
- Existing public state remains readable when the Judge Worker is unavailable,
  but new gameplay submissions are rejected clearly before persistence when the
  worker heartbeat is stale.

## 4. Repository and Service Architecture

The implementation is a Node.js 22 pnpm monorepo:

```text
apps/web                 Next.js UI and authoritative HTTP API
services/judge-worker    Dockerized queue consumer and Harness integration
packages/contracts       Shared API, state, event, and Judge schemas
packages/game-core       Pure deterministic game rules
supabase                 Migrations, seed data, and database tests
docs                     Design, plans, and operational notes
```

System flow:

```text
Browser
  -> Next.js API for every mutation
  -> Supabase Data API for permitted public reads
  -> Supabase Realtime for public change notifications

Next.js API
  -> Supabase Postgres transactions through a server-only connection

Judge Worker
  -> Claims durable database jobs in order
  -> Calls a minimal DeepSeek Harness profile
  -> Validates strict structured output
  -> Commits deterministic results in short transactions
```

### 4.1 Browser Responsibilities

- Render the custom game dashboard.
- Hold only a Supabase publishable key and signed session cookies.
- Display deterministic reactions beside original player messages.
- Subscribe only to public tables.
- Refetch the complete public snapshot after Realtime notifications.
- Never receive solution/key-point/final-answer secrets during an active game.

### 4.2 Next.js Responsibilities

- Issue and validate player and admin cookies.
- Validate input, origin, content type, rate limits, and idempotency.
- Allocate server receipt order.
- Persist player submissions and durable actions atomically.
- Perform administrator lifecycle operations.
- Return only stable public response shapes and safe error codes.

### 4.3 Judge Worker Responsibilities

- Emit a periodic health heartbeat.
- Claim only the current queue head for the current game.
- Run key-point extraction, question judging, and final-answer judging.
- Validate every model output against a strict schema and input-specific ID
  allowlist.
- Apply retries without letting later actions overtake the head.
- Commit verdicts, claims, statistics, scores, reveals, and end state
  transactionally.

### 4.4 Game Core Responsibilities

`packages/game-core` contains pure rules for:

- Verdict-to-reaction mapping.
- Hit-rate numerator and denominator changes.
- Covered-key-point set validation.
- Final-answer success calculation.
- Score deltas.
- Allowed state transitions.

It has no database, network, React, Supabase, or Harness dependency.

## 5. Identity and Administration

### 5.1 Player Session

`POST /api/player-session` normalizes a nickname, finds or creates the player,
and returns a signed `HttpOnly` cookie containing the player ID. Later mutation
requests derive player ID from the cookie and do not accept arbitrary player ID
input.

Nickname rules:

- 1-24 Unicode characters after trimming.
- NFKC normalization.
- Case-insensitive English comparison.
- No NUL, newline, or invisible control characters.

The cookie prevents accidental client-side player ID substitution but does not
make nickname identity secure. Anyone may deliberately rejoin with the same
nickname.

The player cookie lasts 365 days. On each visit with a valid cookie, the client
calls the idempotent current-game join endpoint so the player appears in that
game's statistics even before submitting a message.

### 5.2 Admin Session

The administrator submits nickname and `ADMIN_SECRET` over HTTPS. The server:

- Compares the secret in constant time against an environment variable.
- Stores neither the secret nor its hash in public Supabase data.
- Issues a short-lived signed `HttpOnly`, `Secure`, `SameSite=Strict` admin
  cookie.
- Uses the nickname only as an audit display value.
- Rate-limits login attempts by IP.

The secret never enters a frontend bundle, browser storage, URL, database row,
or log message.

The admin cookie lasts eight hours. Cookies set `Secure` in production; local
HTTP development uses the corresponding non-Secure localhost setting only.

## 6. Game Lifecycle

Public lifecycle:

```text
WAITING -> ACTIVE -> ENDED
```

### 6.1 WAITING

- Created after an administrator supplies a puzzle surface and full solution.
- Surface and solution remain in private storage.
- A key-point extraction job runs before activation.
- Extraction failure leaves the game WAITING, surfaces a safe admin error, and
  permits retry.
- The administrator may replace both inputs while WAITING and start a fresh
  extraction attempt.
- Players see only that a game is being prepared.

### 6.2 ACTIVE

- Entered only after validating exactly 3-5 non-empty key points.
- Activation atomically freezes key points and copies the puzzle surface into
  public data.
- New game creation and key-point modification are forbidden.
- Normal messages and final answers are accepted while the worker is healthy.

### 6.3 ENDED

Reached by:

- A successful final answer; or
- An explicit confirmed admin force-end action.

On successful final answer:

- Award +2 once.
- Publish a success event.
- Reveal the solution and all key points.
- Cancel all later actions.

On force end:

- Award no final-answer points.
- Preserve all prior key-point claims, scores, messages, statistics, and events.
- Reveal the solution and all key points.
- Cancel all pending actions.

No new normal or final-answer submission is accepted after end.

### 6.4 Lifecycle Integrity

A partial unique index over a constant expression where game status is
`WAITING` or `ACTIVE` enforces at most one open game. Activation, successful
completion, and force end recheck current status inside their transaction.

## 7. Supabase Data Design

Use two schemas:

- `api`: explicitly exposed, client-safe data.
- `private`: not exposed through the Data API or Realtime.

### 7.1 Public Tables

#### `api.players`

- `id uuid primary key`
- `display_nickname text not null`
- `lifetime_score integer not null default 0 check (lifetime_score >= 0)`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

#### `api.games`

- `id uuid primary key`
- `status game_status not null`
- `puzzle_surface text null`
- `key_point_total smallint not null default 0`
- `discovered_key_point_count smallint not null default 0`
- `total_question_count integer not null default 0`
- `end_reason game_end_reason null`
- `winner_player_id uuid null references api.players(id)`
- `created_at`, `activated_at`, `ended_at`, `updated_at`

`puzzle_surface` must be null in WAITING and non-null in ACTIVE/ENDED.

#### `api.messages`

- `id uuid primary key`
- `game_id uuid not null references api.games(id)`
- `player_id uuid not null references api.players(id)`
- `sequence_no bigint not null`
- `content text not null`
- `status message_status not null`
- `verdict judge_verdict null`
- `awarded_points smallint not null default 0`
- `created_at`, `judged_at`, `updated_at`

Unique: `(game_id, sequence_no)`.

#### `api.game_events`

- `id uuid primary key`
- `game_id uuid not null references api.games(id)`
- `sequence_no bigint not null`
- `event_type public_game_event_type not null`
- `player_id uuid null references api.players(id)`
- `awarded_points smallint not null default 0`
- `created_at timestamptz not null`

No event contains final-answer text, missing-key information, or explanation.

#### `api.game_player_stats`

- `game_id uuid references api.games(id)`
- `player_id uuid references api.players(id)`
- `question_count integer not null default 0`
- `yes_count integer not null default 0`
- `updated_at timestamptz not null`
- Primary key: `(game_id, player_id)`

Hit rate is calculated as `yes_count / question_count`; it is not stored.

#### `api.game_reveals`

- `game_id uuid primary key references api.games(id)`
- `full_solution text not null`
- `revealed_at timestamptz not null`

#### `api.revealed_key_points`

- `game_id uuid references api.games(id)`
- `ordinal smallint not null`
- `content text not null`
- Primary key: `(game_id, ordinal)`

Reveal rows are inserted only by an end-game transaction.

### 7.2 Private Tables

#### `private.player_identities`

- `player_id uuid primary key references api.players(id)`
- `nickname_key text unique not null`

#### `private.game_secrets`

- `game_id uuid primary key references api.games(id)`
- `puzzle_surface text not null`
- `full_solution text not null`
- `input_version integer not null`
- `updated_at timestamptz not null`

#### `private.key_points`

- `id uuid primary key`
- `game_id uuid not null references api.games(id)`
- `ordinal smallint not null check (ordinal between 1 and 5)`
- `content text not null`
- `created_at timestamptz not null`
- Unique: `(game_id, ordinal)`

Key-point rows are immutable after activation.

#### `private.key_point_claims`

- `key_point_id uuid primary key references private.key_points(id)`
- `game_id uuid not null references api.games(id)`
- `message_id uuid not null references api.messages(id)`
- `player_id uuid not null references api.players(id)`
- `claimed_at timestamptz not null`

The key-point primary key provides atomic first ownership and idempotency.

#### `private.key_point_extraction_jobs`

- Game and input version.
- Status, attempt count, retry time, lease owner, lease expiry.
- Stable error code and timestamps.
- Unique active job per `(game_id, input_version)`.

#### `private.game_actions`

- `id uuid primary key`
- `game_id`, `player_id`, `sequence_no`, and action type.
- Status, attempts, retry time, lease owner, and lease expiry.
- Idempotency key, payload hash, and result resource ID.
- Safe last error code and timestamps.
- Unique `(game_id, sequence_no)`.
- Unique `(game_id, player_id, action_type, idempotency_key)`.

Action types are `NORMAL_MESSAGE` and `FINAL_ANSWER`.

#### `private.final_answer_submissions`

- `id uuid primary key`
- `action_id uuid unique not null`
- `game_id`, `player_id`, and private answer text.
- Private covered-key-point IDs and status.
- Created and judged timestamps.

No read endpoint exposes this table.

#### Other Private Tables

- `private.judge_attempts`: provider, model, skill/prompt/schema version,
  attempt number, latency, token counts, validated result or safe error code.
- `private.admin_audit_events`: admin nickname, action type, target, timestamp,
  and safe metadata.
- `private.request_idempotency`: actor scope, operation type, idempotency key,
  HMAC payload digest, safe result resource ID/status, and timestamps. This
  covers administrator and non-action mutations as well as player actions.
- `private.rate_limit_buckets`: fixed-window counters and expiry.
- `private.worker_heartbeats`: worker ID, start time, last seen time, and build
  version.

Full sensitive prompts, raw model responses, and reasoning are not stored.

### 7.3 Indexes

Required indexes include:

- `api.messages(game_id, sequence_no)`.
- `api.game_events(game_id, sequence_no)`.
- Every foreign-key column not already covered by a leftmost index.
- `private.key_points(game_id, ordinal)`.
- Partial queue-head index on `private.game_actions(game_id, sequence_no)` for
  `PENDING`, `RETRY`, and `BLOCKED` statuses.
- `private.judge_attempts(action_id, attempt_no)`.

### 7.4 Grants, RLS, and Realtime

- Only `api` is an exposed Data API schema.
- Every `api` table has RLS enabled.
- `anon` receives SELECT only on named public tables, with explicit read
  policies.
- `anon` receives no INSERT, UPDATE, DELETE, or routine execution permission.
- `private` is revoked from `PUBLIC`, `anon`, and `authenticated` and is not an
  exposed schema.
- Realtime publication contains only public tables.
- Browser code uses only a publishable key.
- Next.js uses a `game_web` database role with required DML but no DDL.
- Worker uses a `judge_worker` role with required private read/result write DML
  but no DDL.
- Migrations use a separate privileged credential.

Next.js uses the Supavisor transaction pooler with prepared statements disabled.
The persistent Worker uses a direct connection when available, otherwise the
session pooler.

## 8. Durable Serial Judge Queue

### 8.1 Receipt Ordering

Normal messages and final answers enter one per-game action sequence. The API
locks the current game, verifies ACTIVE status, allocates the next sequence,
persists the public/private records, updates submission counters, and commits.

The sequence represents server receipt order, not browser time or model
completion time.

### 8.2 Worker Lease

- The Worker may claim only the smallest incomplete sequence for an ACTIVE
  game.
- The claim transaction records a short lease and commits before model I/O.
- A second Worker cannot claim a later sequence while the head is leased.
- A crashed Worker's lease expires and the same head becomes claimable again.
- `SKIP LOCKED` is not used to jump to a later action in the same game.

### 8.3 Retry and Blocking

```text
PENDING -> PROCESSING -> COMPLETED
                      -> RETRY
                      -> BLOCKED
                      -> CANCELLED
```

- Retry transport errors, timeouts, empty responses, invalid JSON, schema
  failures, and unknown IDs up to four total attempts: one initial attempt and
  three retries.
- Retry backoff schedule: 2 seconds, 5 seconds, then 15 seconds.
- After the fourth failed attempt, mark the head BLOCKED.
- A BLOCKED head prevents later actions from running.
- The corresponding public message shows an error/retry state.
- A minimal admin control returns the head to RETRY.
- Force end remains available.

### 8.4 Atomic Normal-Message Commit

After model I/O, one short transaction:

1. Rechecks game ACTIVE status and current head ownership.
2. Validates verdict and covered key-point IDs.
3. Locks involved key points in stable ID order.
4. Inserts first claims; primary-key conflicts mean already claimed.
5. Counts newly inserted claims and adds that amount to lifetime score.
6. Increments YES count only when verdict is YES.
7. Updates public message, discovered progress, and awarded points.
8. Completes the action and lease.

The transaction is idempotent. Repeating it cannot double-award points.

### 8.5 Atomic Final-Answer Commit

The model returns only covered IDs. Server code validates and de-duplicates them
and compares the set with every fixed key point.

On failure:

- Complete the action.
- Publish a failure event without content, count, IDs, or explanation.
- Do not change score or question statistics.

On success, one transaction:

- Recheck ACTIVE status and head ownership.
- Add +2 once.
- Mark the game ENDED with the winner.
- Publish success.
- Copy solution and key points into public reveal tables.
- Cancel every later action.

### 8.6 Force End Race

Force end atomically marks the game ENDED, publishes the event/reveal, and
cancels incomplete actions. A Worker result that arrives afterward fails its
ACTIVE-state recheck and cannot modify public state or scores.

## 9. Harness and Semantic Judge Design

### 9.1 Technical Spike Gate

Before application implementation, prove the selected DeepSeek Harness version
can:

- Run in Docker.
- Register configurable provider/model adapters.
- Run without tools, filesystem, shell, network tools, subagents, memory, or
  conversation history.
- Execute one isolated structured request.
- Avoid persistent sensitive session logs.
- Surface invalid output and transport errors.

Pin the exact package version or Git commit. The stock headless profile is not
used because it includes a coding persona, tool mode, and persisted Agent
session. A custom minimal profile/plugin is required.

If the spike fails, implementation stops and reports the exact blocker. It does
not silently replace Harness with a different SDK.

### 9.2 Application Boundary

```ts
interface SemanticJudge {
  extractKeyPoints(input: KeyPointExtractionInput): Promise<KeyPointExtractionResult>;
  judgeQuestion(input: QuestionJudgeInput): Promise<QuestionJudgeResult>;
  judgeFinalAnswer(input: FinalAnswerJudgeInput): Promise<FinalAnswerJudgeResult>;
}
```

Production uses `HarnessSemanticJudge`. Core tests use deterministic fake and
fixture implementations.

### 9.3 Key-Point Extraction Skill

Input:

```json
{
  "puzzle_surface": "...",
  "full_solution": "..."
}
```

Output:

```json
{
  "key_points": [
    { "content": "..." }
  ]
}
```

Rules:

- Array length 3-5.
- Non-empty bounded content.
- No extra fields.
- No model-generated IDs.
- Server generates UUIDs and rejects normalized exact duplicates.
- Invalid output prevents activation.

### 9.4 Question Judge Skill

Input includes puzzle surface, full solution, every fixed key point, and only the
current player message. It excludes message history and discovered state.

Output:

```json
{
  "verdict": "YES",
  "fully_covered_key_point_ids": ["uuid"]
}
```

Rules:

- Verdict enum only.
- IDs must be unique and belong to the input allowlist.
- Verdict and coverage are independent.
- BOTH may fully cover a key point.
- The model never decides whether coverage earns points.

### 9.5 Final-Answer Judge Skill

Input contains fixed key points and the private submitted answer.

Output:

```json
{
  "covered_key_point_ids": ["uuid"]
}
```

It does not output success, missing counts, missing IDs, explanations, or hints.

### 9.6 Provider Configuration

Server-only environment variables:

- `JUDGE_PROVIDER`
- `JUDGE_MODEL`
- `JUDGE_API_BASE_URL`
- `JUDGE_API_KEY`
- `JUDGE_TIMEOUT_MS`

Provider adapters may use native JSON Schema when supported. Otherwise the same
output is requested as JSON and strictly validated. Invalid output is retried;
no heuristic string repair is applied.

### 9.7 Prompt Injection Boundary

- All puzzle/player fields are explicitly untrusted data.
- Static instructions and structured input are separated.
- The model receives no tools, secrets, database access, or environment access.
- Output schemas permit no player-facing free text.
- IDs are checked against an input-specific allowlist.
- Raw responses, prompts, and reasoning do not reach the browser or public logs.

Injection can cause a bad/invalid classification but cannot directly expose data,
modify score, or execute an operation.

## 10. HTTP API

All handlers use the Node.js runtime. Current-state reads use `no-store`.

### 10.1 Player Routes

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/player-session` | Join/find player and set cookie |
| `GET` | `/api/game/current` | Complete current public snapshot |
| `POST` | `/api/game/current/join` | Idempotently join the current game's statistics |
| `POST` | `/api/game/current/messages` | Submit a normal message |
| `POST` | `/api/game/current/final-answers` | Submit a private final answer |

### 10.2 Admin Routes

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/admin/session` | Authenticate admin |
| `DELETE` | `/api/admin/session` | Clear admin session |
| `GET` | `/api/admin/status` | Safe status/error data only |
| `POST` | `/api/admin/games` | Create WAITING game and extraction job |
| `PUT` | `/api/admin/games/current/preparation` | Replace WAITING inputs and extract |
| `POST` | `/api/admin/games/current/retry-extraction` | Retry saved input |
| `POST` | `/api/admin/games/current/retry-blocked-action` | Retry queue head |
| `POST` | `/api/admin/games/current/force-end` | Confirmed force end |

Admin status never returns stored solution or key-point contents to the browser.

`GET /api/game/current` returns the newest WAITING/ACTIVE game when one exists;
otherwise it returns the most recently ended game. The product has no history
navigation or arbitrary game-ID read route.

### 10.3 Input Limits

| Input | Limit |
|---|---:|
| Nickname | 1-24 characters |
| Normal message | 1-500 characters |
| Final answer | 1-4000 characters |
| Puzzle surface | 1-2000 characters |
| Full solution | 1-8000 characters |

All text is trimmed and rejects NUL and invisible control characters. HTML is
not accepted as a rendering mode.

### 10.4 Idempotency

Every state-changing request requires an `Idempotency-Key` UUID.

- Same key and same payload hash returns the first resource/result.
- Same key and different payload returns `409 IDEMPOTENCY_CONFLICT`.
- Scope includes actor and operation type.
- Payload digests use a server-secret HMAC rather than an unsalted hash, so
  private final answers and solutions cannot be tested against stored digests.

### 10.5 Rate Limits

| Operation | Limit |
|---|---:|
| Player join | 10/IP/minute |
| Normal message | 12/player/minute and 30/IP/minute |
| Final answer | 3/player/5 minutes |
| Admin login | 5/IP/15 minutes |
| Other admin writes | 10/admin session/minute |

Rate-limit responses include `429`, stable error JSON, and `Retry-After`.
IP-based buckets store a server-secret HMAC of the normalized address rather
than the raw address.

### 10.6 Worker Availability

The Worker updates its heartbeat every 10 seconds. A heartbeat older than 30
seconds is stale.

When stale:

- Public reads continue.
- New normal messages, final answers, and extraction requests return
  `503 JUDGE_UNAVAILABLE` before persistence.
- Already persisted actions remain durable.

### 10.7 Request Security

- State-changing routes accept only JSON.
- Origin must match the configured site origin.
- No cross-origin mutation API is enabled.
- Player cookie: `HttpOnly`, `Secure`, `SameSite=Lax`.
- Admin cookie: `HttpOnly`, `Secure`, `SameSite=Strict`.
- Secret/sensitive text never appears in URLs or returned database errors.

Stable error codes:

- `VALIDATION_ERROR`
- `PLAYER_SESSION_REQUIRED`
- `ADMIN_SESSION_REQUIRED`
- `NO_CURRENT_GAME`
- `GAME_NOT_ACTIVE`
- `GAME_ALREADY_ACTIVE`
- `JUDGE_UNAVAILABLE`
- `QUEUE_BLOCKED`
- `RATE_LIMITED`
- `IDEMPOTENCY_CONFLICT`
- `INTERNAL_ERROR`

## 11. Frontend Design

### 11.1 Routes

- `/`: player game page.
- `/admin`: minimal admin page.

No room, history, or standalone ranking page exists.

### 11.2 Desktop Layout

- Header with game status, player, connection state, and admin link.
- Full-width puzzle surface and key-point progress.
- Main message stream with narrow player-statistics sidebar.
- Sticky composer with Send and separate Final Answer button.
- Row layout: nickname, message body, reaction/points, Challenge control.
- No chat bubbles, AI avatar, or separate AI messages.

Visual direction is a high-contrast deep navy/teal modern game dashboard with
lightweight transitions and no elaborate animated background.

### 11.3 Mobile Layout

- Status, puzzle, progress, message stream, and fixed composer in that order.
- Player statistics move to a drawer.
- Reactions stay in the original message row's right column.
- Puzzle surface is not hidden by default.

### 11.4 Components

```text
GameClient
  NicknameGate
  GameHeader / ConnectionStatus
  WaitingForGame
  PuzzlePanel / KeyPointProgress
  MessageFeed
    MessageRow / VerdictReaction / AwardedPoints / ChallengeButton
    PublicGameEventRow
  PlayerStatsPanel
  MessageComposer
  FinalAnswerModal
  GameRevealPanel

AdminPanel
  AdminLoginForm
  GamePreparationForm
  ExtractionStatus
  RetryExtractionButton
  RetryBlockedActionButton
  ForceEndControl
```

### 11.5 Message UX

Client/display states:

- `SENDING`: local optimistic row before API confirmation.
- `PENDING`: persisted and publicly visible as judging.
- `JUDGED`: deterministic verdict and awarded points.
- `ERROR`: blocked judgment awaiting admin retry.
- `CANCELLED`: game ended before judgment.

Failed API submission removes the local SENDING row and shows a composer error.

### 11.6 Realtime Strategy

Subscribe to the relevant public tables for the current game. Realtime events
are invalidation signals rather than the sole source of truth:

- Coalesce events for 100 milliseconds.
- Refetch `/api/game/current`.
- Replace server state with the full snapshot.
- Preserve only local SENDING rows.
- Merge messages and events by sequence.

While disconnected, show status and poll the snapshot every five seconds. On
reconnect, refetch immediately.

### 11.7 Statistics

Display nickname, lifetime score, current-game question count, and hit rate.

Sort by:

1. Lifetime score descending.
2. Current-game YES count descending.
3. Nickname ascending.

Zero-question hit rate displays `—`.

### 11.8 Final Answer and Reveal

The final-answer modal includes a privacy notice and clears answer text after a
successful API receipt. It never renders submitted text into public history.

After game end:

- Disable normal and final-answer inputs.
- Preserve history and statistics.
- Show full solution and ordered key points.
- Show winner and +2 only for successful completion.

### 11.9 Challenge Placeholder

Every judged message has a lightweight `Challenge / 质疑` control. It only
shows:

```text
Challenge feature is under development.
```

It has no API, database record, rejudge, verdict change, or score change.

### 11.10 Accessibility

- Reactions include accessible text and do not rely on color alone.
- New judgments use a polite live region.
- Modals trap and restore focus and support Escape.
- All controls work by keyboard.
- Respect reduced-motion preference.
- Maintain readable contrast at desktop and mobile widths.

## 12. Testing Strategy

### 12.1 Deterministic Unit Tests

- Verdict mapping.
- Hit-rate rules.
- Multi-key-point scoring.
- Repeat-claim rejection.
- BOTH plus key-point coverage.
- Final-answer all-or-nothing success.
- No +1 from final answers.
- Force-end scoring.
- Ended-game submission rejection.

### 12.2 Judge Contract and Benchmark Tests

Validate schemas, extra-field rejection, unknown/duplicate IDs, invalid enums,
timeouts, empty responses, and provider errors.

Fixtures cover:

- Same meaning with different wording -> YES.
- Clearly false -> NO.
- Partly correct and partly incorrect -> BOTH.
- Irrelevant true detail -> IRRELEVANT.
- Explicit relationship true/false -> YES/NO.
- Full multi-key-point hit.
- BOTH while fully covering one key point.
- Close/partial key point without a hit.
- Repeated discovered point without a new award.
- Prompt injection.
- Final answer covering 3/4 -> fail.
- Final answer covering 4/4 -> success.
- Chinese paraphrases and incomplete pronoun-only messages.

Provider benchmarks record correctness, schema compliance, latency, token use,
and cost but do not gate normal CI nondeterministically.

### 12.3 Database and Security Tests

- Single open-game constraint.
- Public/private grants and RLS.
- WAITING and ACTIVE negative-leak checks.
- Ended reveal availability.
- Final-answer privacy after end.
- Atomic unique claims and idempotency.
- Index and Realtime publication audit.
- Supabase database advisors.

### 12.4 Queue and Concurrency Tests

- Earlier receipt wins same key point despite later faster model response.
- Failed head blocks later actions.
- Lease expiry safely reclaims the same action.
- Duplicate result submission is idempotent.
- Earlier normal message precedes later final answer.
- Successful final answer cancels later actions.
- Force end rejects late Worker commit.
- Two Workers cannot process different actions in the same game concurrently.

### 12.5 API Tests

- Nickname normalization and session recovery.
- Cookie validation and admin login rate limiting.
- Input limits and control-character rejection.
- Idempotency replay/conflict.
- Heartbeat-based 503 behavior.
- State conflict behavior.
- Origin/content-type enforcement.
- Sensitive error redaction.

### 12.6 Browser E2E

Use two browser contexts at 1440x900 and 390x844 to run the complete MVP flow,
including pending messages, first-hit scoring, repeated hits, ordered rapid
submissions, private final-answer failure, successful end, reveal, refresh, and
next-game creation.

## 13. Implementation Milestones

### Milestone 0: Harness Feasibility Spike

Docker, isolated tool-free single calls, provider switching, schema validation,
no sensitive persistence, and pinned version. Failure stops implementation for
user decision.

### Milestone 1: Workspace, Contracts, and Game Core

Node.js 22 monorepo, shared schemas, pure game rules, Fake Judge, tests, lint,
typecheck, and builds.

### Milestone 2: Supabase Schema and Security

Migrations, roles, RLS, public/private split, indexes, constraints, database
tests, and advisors.

### Milestone 3: Identity, Admin, and Lifecycle API

Sessions, preparation, extraction retry, activation, force end, rate limiting,
idempotency, and stable errors.

### Milestone 4: Durable Queue and Judge Skills

Leases, retries, blocking, all three Skills, atomic claims/scoring, final-answer
end transaction, and concurrency tests.

### Milestone 5: Multiplayer UI and Realtime

Responsive dashboard, message states, progress, statistics, subscriptions,
reconnect, Challenge placeholder, and accessibility.

### Milestone 6: Final Answer, Reveal, and Admin Recovery

Private submission UX, public success/failure events, reveal, blocked-action
retry, and ended-game controls.

### Milestone 7: Acceptance and Deployment Readiness

Full two-browser E2E, ten-player burst check, production Next.js build, Docker
build, environment documentation, and client-payload secret audit.

## 14. Highest-Risk Areas

- DeepSeek Harness developer-preview compatibility and sensitive session
  persistence.
- Model schema compliance and semantic consistency.
- Strict action ordering across retries, restarts, and multiple Workers.
- Atomic key-point ownership and lifetime score updates.
- Accidental exposure through Data API, Realtime, browser bundles, or logs.
- Final-answer privacy under accepted nickname impersonation.
- Anonymous model-cost abuse.
- Serverless database connection handling.

Each risk has an explicit spike, constraint, test, or operational guard in this
design.

## 15. MVP Acceptance Flow

The MVP is complete only when this full flow is verified:

1. A player enters a nickname.
2. An admin authenticates with the admin secret.
3. The admin submits a puzzle surface and full solution.
4. Harness extracts and the server validates 3-5 frozen key points.
5. The game becomes ACTIVE.
6. Two independent browser sessions see the same game.
7. Player A submits a normal message.
8. Both browsers immediately see its judging state.
9. Both browsers see the deterministic verdict beside the original message.
10. A first full key-point hit awards +1, updates lifetime score, and updates
    progress.
11. Player B repeats the key point without a duplicate award.
12. Rapid submissions remain in server receipt order.
13. A failed final answer publishes failure while keeping text private.
14. A final answer covering every key point succeeds.
15. The winner receives +2 exactly once.
16. The game ends and rejects new submissions.
17. The solution and all key points become public.
18. Lifetime scores survive refresh and the next game.
19. The admin can create the next game.

## 16. Definition of Done

- All 19 acceptance steps pass.
- Privacy and RLS negative tests pass.
- Queue ordering, lease recovery, and idempotency tests pass.
- Semantic benchmark fixtures run repeatably across configured providers.
- Next.js production build passes.
- Judge Worker Docker image starts locally and resumes unfinished work.
- Ten-player burst verification produces no reorder or duplicate score.
- Client bundles, HTTP payloads, Realtime payloads, and public logs contain no
  hidden game data or secrets.
- No explicitly out-of-scope feature is implemented.
