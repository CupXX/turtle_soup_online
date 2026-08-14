# First Real Playable Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current demo-heavy repository into one real, locally runnable AI judging loop: an admin prepares a puzzle, the Worker extracts key points and activates it, a player joins and submits a question, and the ordered Worker verdict atomically updates the original message, score, and progress.

**Architecture:** Preserve the approved Next.js + Supabase + serial Judge Worker design. Finish one vertical slice before adding final answers: browser mutations go through Next.js, Postgres owns receipt order and atomic state, and the Worker calls the isolated Harness outside transactions. Fake Judge remains the deterministic integration-test adapter; it is not a production fallback.

**Tech Stack:** Node.js 22, pnpm 10.33.2, Next.js 16.3.1, React 19.2.8, TypeScript, Supabase CLI 2.114.0/Postgres 17, Postgres.js 3.4.9, Vitest 4.1.10, Ajv 8.20.0, Docker Desktop, and `@deepseek-ai/dsh@0.1.0-rc.6` only if Task 1 records GO.

## Global Constraints

- Source of truth remains `docs/superpowers/specs/2026-08-14-multiplayer-turtle-soup-design.md`.
- Keep one current game and no rooms; 10 active players is a verification target, not an admission cap.
- Do not change the approved scoring, verdict, sequence, privacy, or lifecycle rules.
- Browser access remains read-only for named `api` tables and has no `private` access.
- Every browser mutation goes through a same-origin Next.js Route Handler.
- Hidden solution, key points, model attempts, and queue state never enter browser payloads or logs.
- The LLM never owns ordering, score, first-hit claims, game state transitions, or authorization.
- External Harness/model calls occur outside database transactions.
- Queue processing is serial by receipt sequence; do not use `SKIP LOCKED` to overtake a head.
- Use TDD, make the smallest change for each task, and stage only that task's named files.
- Run application verification under Node.js 22. The current host Node.js 24 warning is not accepted as Node.js 22 verification.

---

## Current State Audit

### Confirmed working

- Workspace, shared contracts, and deterministic game-core rules are committed.
- Supabase starts locally; both migrations apply; schema/security pgTAP suites pass (55 tests).
- Signed player/admin sessions, validation, rate-limit, and idempotency primitives exist.
- Current snapshot, join, and admin preparation handlers exist.
- Queue leasing/heartbeat primitives and strict semantic-result validation exist.
- Existing non-Task-12 suites pass: contracts 3, game-core 12, Worker 19, web 56.
- Existing web lint passes; Worker typecheck and build pass.

### Partial or currently blocked

- Harness image builds, but container execution fails because `node-pty` was installed with scripts disabled; runtime decision remains NO-GO.
- Admin preparation creates extraction jobs, but no extraction processor consumes and completes them.
- Worker code exports primitives but has no production composition/entrypoint or deployable Dockerfile.
- `apps/web/src/server/game/submit-message.test.ts` and `apps/web/src/app/api/game/current/messages/route.test.ts` are intentionally RED and uncommitted; their production modules do not exist.
- No question processor or atomic score/claim commit exists.
- Player and admin pages still run demo data/callbacks rather than real APIs.
- Runtime roles can access far more tables/operations than their responsibilities require.
- Database lifecycle, queue, and scoring suites planned as `003`/`004`/`005` do not exist.
- Full web typecheck/build currently fails only because the two RED Task-12 tests import missing production modules.

### Deliberately deferred until the following phase

- Private final-answer submission, final-answer judgment, success/failure events, +2 winner score, reveal, and cancellation.
- Admin force-end and blocked-action retry.
- Full Playwright two-browser acceptance, 10-player load proof, deployment configuration, and production rollout.

---

## Planned File Map

```text
spikes/deepseek-harness/
  Dockerfile
  pnpm-workspace.yaml
  README.md
docs/decisions/0001-judge-worker-runtime.md
apps/web/src/server/game/submit-message.ts
apps/web/src/app/api/game/current/messages/route.ts
apps/web/src/lib/game-api.ts
services/judge-worker/src/db/complete-extraction.ts
services/judge-worker/src/db/complete-question.ts
services/judge-worker/src/processors/extraction-processor.ts
services/judge-worker/src/processors/question-processor.ts
services/judge-worker/src/runtime/create-harness-invoker.ts
services/judge-worker/src/main.ts
services/judge-worker/Dockerfile
supabase/tests/database/003_lifecycle.test.sql
supabase/tests/database/004_queue.test.sql
supabase/tests/database/005_question_scoring.test.sql
```

## Task 1: Resolve the Harness Docker Gate

**Files:**
- Create: `spikes/deepseek-harness/pnpm-workspace.yaml`
- Modify: `spikes/deepseek-harness/Dockerfile`
- Modify: `spikes/deepseek-harness/README.md`
- Modify: `docs/decisions/0001-judge-worker-runtime.md`
- Test: `spikes/deepseek-harness/src/probe.test.ts`

**Interfaces:**
- Consumes: pinned `@deepseek-ai/dsh@0.1.0-rc.6` and `node-pty@1.1.0`.
- Produces: a truthful GO/NO-GO runtime decision and a reproducible Node.js 22 container command.

- [ ] **Step 1: Preserve the current failing evidence**

Run:

```powershell
docker build -f spikes/deepseek-harness/Dockerfile -t turtle-soup-harness-spike .
docker run --rm turtle-soup-harness-spike
```

Expected before the fix: build succeeds; run fails with missing `prebuilds/linux-x64/pty.node` because `--ignore-scripts` prevented the required native dependency build.

- [ ] **Step 2: Permit only the required dependency build**

Use pnpm's package-specific build allowlist, not a blanket script permission:

```yaml
packages:
  - .
allowBuilds:
  node-pty: true
```

Copy this file into the Docker dependency layer and replace:

```dockerfile
RUN pnpm install --frozen-lockfile --ignore-scripts
```

with:

```dockerfile
COPY spikes/deepseek-harness/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile
```

Do not approve all dependency scripts. The implementation must review the `node-pty` package script recorded by the lockfile before enabling it.

- [ ] **Step 3: Rebuild without cache and run the probe**

Run:

```powershell
docker build --no-cache -f spikes/deepseek-harness/Dockerfile -t turtle-soup-harness-spike .
docker run --rm turtle-soup-harness-spike
```

Expected: three structured fixture results, `toolsExposed: []`, `persistenceFiles: []`, one provider request per fixture, and exit code 0.

- [ ] **Step 4: Keep the decision gate honest**

If Step 3 passes, change the decision to GO and record the image command, Node.js version, Harness version, profile path, and evidence. If it fails for any other Harness/runtime reason, record that exact error as NO-GO and stop Harness production integration before Task 5; Tasks 2–4 may still use Fake Judge for deterministic development.

- [ ] **Step 5: Verify and commit the gate**

Run:

```powershell
pnpm --dir spikes/deepseek-harness test
docker run --rm turtle-soup-harness-spike
git diff --check
git add -- spikes/deepseek-harness docs/decisions/0001-judge-worker-runtime.md
git diff --cached --name-only
git commit -m "fix: make harness probe runnable in docker"
```

## Task 2: Complete Extraction and Automatic Activation

**Files:**
- Create: `services/judge-worker/src/db/complete-extraction.ts`
- Create: `services/judge-worker/src/db/complete-extraction.test.ts`
- Create: `services/judge-worker/src/processors/extraction-processor.ts`
- Create: `services/judge-worker/src/processors/extraction-processor.test.ts`
- Modify: `services/judge-worker/src/index.ts`
- Test: `supabase/tests/database/003_lifecycle.test.sql`

**Interfaces:**
- Consumes: `ClaimedExtraction`, `SemanticJudge.extractKeyPoints`, and current `private.game_secrets` version.
- Produces:

```ts
export type CompleteExtractionInput = {
  jobId: string;
  gameId: string;
  inputVersion: number;
  workerId: string;
  keyPoints: Array<{ content: string }>;
};

export async function completeExtraction(
  input: CompleteExtractionInput,
  dependencies?: CompleteExtractionDependencies,
): Promise<void>;

export async function processExtraction(
  job: ClaimedExtraction,
  dependencies: { judge: SemanticJudge; workerId: string },
): Promise<void>;
```

- [ ] **Step 1: Write failing processor and transaction tests**

Cover: the processor loads only the claimed version's surface/solution; the judge call completes before the write transaction starts; exactly 3–5 unique normalized key points activate WAITING; stale input version, lost lease, wrong owner, and non-WAITING game commit nothing; repeated completion is safe; no solution/key-point content is logged.

- [ ] **Step 2: Add the missing lifecycle database tests**

`003_lifecycle.test.sql` must prove:

```sql
-- one WAITING or ACTIVE game only
-- key points reject UPDATE/DELETE after activation
-- stale extraction version cannot activate
-- activation publishes only puzzle_surface and counts
-- full_solution and key-point text remain private
```

Run the focused suites and confirm failure because the Worker modules do not exist.

- [ ] **Step 3: Implement short read/call/write boundaries**

The processor flow is exactly:

```ts
const input = await loadExtractionInput(job);
const result = await dependencies.judge.extractKeyPoints(input);
await completeExtraction({
  jobId: job.id,
  gameId: job.gameId,
  inputVersion: job.inputVersion,
  workerId: dependencies.workerId,
  keyPoints: result.key_points,
});
```

`completeExtraction` opens one short transaction, locks the job/game/secret rows, verifies the active lease and version, inserts server-generated key-point UUIDs, publishes the surface/count, transitions WAITING to ACTIVE, and marks only that job COMPLETED. Lock rows before generating writes; never hold the transaction during the semantic call.

- [ ] **Step 4: Verify and commit extraction**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test -- extraction
pnpm --filter @turtle-soup/judge-worker typecheck
pnpm exec supabase test db --local
git add -- services/judge-worker/src/db/complete-extraction.ts services/judge-worker/src/db/complete-extraction.test.ts services/judge-worker/src/processors/extraction-processor.ts services/judge-worker/src/processors/extraction-processor.test.ts services/judge-worker/src/index.ts supabase/tests/database/003_lifecycle.test.sql
git diff --cached --name-only
git commit -m "feat: activate games from extracted key points"
```

## Task 3: Finish Ordered Normal-Message Receipt

**Files:**
- Create: `apps/web/src/server/game/submit-message.ts`
- Create: `apps/web/src/app/api/game/current/messages/route.ts`
- Modify: `apps/web/src/server/security/idempotency.ts`
- Modify: `apps/web/src/server/security/idempotency.test.ts`
- Test: `apps/web/src/server/game/submit-message.test.ts` (already RED and uncommitted)
- Test: `apps/web/src/app/api/game/current/messages/route.test.ts` (already RED and uncommitted)

**Interfaces:**
- Produces:

```ts
export type SubmitMessageInput = {
  playerId: string;
  content: string;
  idempotencyKey: string;
  payloadDigest: string;
};

export async function submitMessage(
  input: SubmitMessageInput,
  dependencies?: SubmitMessageDependencies,
): Promise<PublicMessage>;

export async function bindIdempotencyResult(input: {
  actorScope: string;
  operation: string;
  key: string;
  resultResourceId: string;
  responseStatus: number;
}): Promise<void>;
```

- [ ] **Step 1: Extend the existing RED tests before implementation**

Add cases for normalized 1–500 character content, missing/invalid idempotency key, same-key/same-payload replay returning the same public message, same-key/different-payload conflict, stale/missing heartbeat returning 503, WAITING/ENDED rejection, per-player and per-IP limits, and counter updates exactly once.

- [ ] **Step 2: Verify focused failure**

Run:

```powershell
pnpm --filter @turtle-soup/web exec vitest run src/server/game/submit-message.test.ts src/app/api/game/current/messages/route.test.ts --reporter=verbose
```

Expected: fail because `submit-message.ts` and `route.ts` are missing.

- [ ] **Step 3: Implement one receipt transaction**

Inside `submitMessage`: require a fresh Worker heartbeat; lock the current game; require ACTIVE; return the prior result for a matching `private.game_actions` idempotency row; allocate `sequenceNo = max(private.game_actions.sequence_no) + 1`; insert one PENDING `api.messages` row and one PENDING NORMAL_MESSAGE action with `result_resource_id = messageId`; increment game/player question counters once; return the public row.

The HTTP handler performs same-origin, JSON, signed player session, both rate limits, content normalization, payload digest, and idempotency claim before calling `submitMessage`. After success it binds the public message UUID to the request-idempotency row. It returns status 200 with only the public message.

- [ ] **Step 4: Verify and commit receipt**

Run focused tests, web typecheck, web lint, and web build. Stage only the files above and commit:

```powershell
git commit -m "feat: accept ordered player questions"
```

## Task 4: Atomically Judge, Claim, Score, and Publish Questions

**Files:**
- Create: `services/judge-worker/src/db/complete-question.ts`
- Create: `services/judge-worker/src/db/complete-question.test.ts`
- Create: `services/judge-worker/src/processors/question-processor.ts`
- Create: `services/judge-worker/src/processors/question-processor.test.ts`
- Modify: `services/judge-worker/src/index.ts`
- Test: `supabase/tests/database/004_queue.test.sql`
- Test: `supabase/tests/database/005_question_scoring.test.sql`

**Interfaces:**
- Produces:

```ts
export type ClaimedQuestionAction = ClaimedAction & {
  actionType: 'NORMAL_MESSAGE';
};

export type CompleteQuestionInput = {
  actionId: string;
  workerId: string;
  verdict: JudgeVerdict;
  fullyCoveredKeyPointIds: string[];
};

export async function processQuestion(
  action: ClaimedQuestionAction,
  dependencies: { judge: SemanticJudge; workerId: string },
): Promise<void>;

export async function completeQuestion(
  input: CompleteQuestionInput,
  dependencies?: CompleteQuestionDependencies,
): Promise<void>;
```

- [ ] **Step 1: Write failing unit and database tests**

Cover smallest-sequence-only claim, no overtaking BLOCKED/leased head, lease expiry reclaiming the same head, ACTIVE/lease recheck, YES-only hit-rate numerator, NO/IRRELEVANT/BOTH denominator preservation, BOTH with valid claims, multiple first claims awarding one point each, repeated claims awarding zero, unknown/cross-game IDs rejected, duplicate completion idempotency, and ended-game race rejection.

- [ ] **Step 2: Implement processor input isolation**

Load exactly the puzzle surface, full solution, fixed key points, and current message. Do not load conversation history, discovered state, player score, or other messages. Call:

```ts
const result = await dependencies.judge.judgeQuestion({
  puzzle_surface: input.puzzleSurface,
  full_solution: input.fullSolution,
  key_points: input.keyPoints,
  current_message: input.currentMessage,
});
```

Then pass only validated verdict/IDs to `completeQuestion`.

- [ ] **Step 3: Implement one atomic completion transaction**

Lock the PROCESSING action and ACTIVE game; verify `lease_owner` and unexpired lease; lock referenced key points in UUID order; insert claims with `ON CONFLICT DO NOTHING RETURNING`; count only inserted claims; add that count to lifetime score and game discovery count; set the original message to JUDGED with verdict/points; increment `yes_count` only for verdict YES; mark the action COMPLETED and clear lease fields. Record safe attempt metadata without prompt/solution/raw response.

- [ ] **Step 4: Verify and commit judging/scoring**

Run Worker tests/typecheck/build plus all database tests, then commit:

```powershell
git commit -m "feat: judge questions and award first-hit points"
```

## Task 5: Compose a Real Worker Process and Container

**Files:**
- Create: `services/judge-worker/src/runtime/create-harness-invoker.ts`
- Create: `services/judge-worker/src/runtime/create-harness-invoker.test.ts`
- Create: `services/judge-worker/src/processors/action-processor.ts`
- Create: `services/judge-worker/src/processors/action-processor.test.ts`
- Create: `services/judge-worker/src/main.ts`
- Create: `services/judge-worker/src/main.test.ts`
- Create: `services/judge-worker/Dockerfile`
- Modify: `services/judge-worker/package.json`
- Modify: `services/judge-worker/src/db/queue.ts`
- Modify: `services/judge-worker/src/db/queue.test.ts`
- Modify: `services/judge-worker/src/worker.ts`
- Modify: `services/judge-worker/src/worker.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces:

```ts
export function createHarnessInvoker(config: WorkerConfig): HarnessInvoker;
export async function processClaimedAction(action: ClaimedAction, dependencies: ActionProcessorDependencies): Promise<void>;
export async function startWorker(env?: NodeJS.ProcessEnv): Promise<void>;
```

- [ ] **Step 1: Split retry operations by queue kind**

Replace the extraction-only generic retry functions with explicit operations:

```ts
recordExtractionRetry(jobId, attempt, code)
markExtractionBlocked(jobId, code)
recordActionRetry(actionId, attempt, code)
markActionBlocked(actionId, code)
```

Tests must prove each function mutates only its own table and that a fourth failed attempt becomes BLOCKED.

- [ ] **Step 2: Write failing composition tests**

Use injected Fake Judge/DB functions to prove heartbeat startup, extraction priority, NORMAL_MESSAGE dispatch, retry mapping for TIMEOUT/TRANSPORT/validation errors, lease-lost handling, SIGTERM abort, and no later action overtaking a failed head.

- [ ] **Step 3: Implement the production Harness invoker only after GO**

Reuse the exact profile/runtime accepted in Task 1. Each MVP invocation gets a fresh temporary Harness home, zero model-facing tools, one provider request, strict JSON output, timeout/abort, and cleanup in `finally`. Never mount the repository or Docker socket and never persist prompt/session content.

- [ ] **Step 4: Add the executable and Dockerfile**

`main.ts` loads validated environment, creates DB/heartbeat/queue/processors, and calls `runWorker`. The Docker image uses Node.js 22, runs as a non-root user, includes only production/runtime files, has no secret in any layer, and starts `main.js` directly.

- [ ] **Step 5: Verify and commit Worker runtime**

Run:

```powershell
pnpm --filter @turtle-soup/judge-worker test
pnpm --filter @turtle-soup/judge-worker typecheck
pnpm --filter @turtle-soup/judge-worker build
docker build -f services/judge-worker/Dockerfile -t turtle-soup-judge-worker .
docker run --rm --env-file .env.local turtle-soup-judge-worker
```

The final command is a credential-dependent smoke test. It must at minimum start, validate configuration, write a heartbeat, and shut down cleanly; do not commit `.env.local`.

Commit:

```powershell
git commit -m "feat: run the serial judge worker in docker"
```

## Task 6: Replace Demo Pages with the Real Play Loop

**Files:**
- Create: `apps/web/src/lib/game-api.ts`
- Create: `apps/web/src/lib/game-api.test.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/components/game/game-client.tsx`
- Modify: `apps/web/src/components/game/game-client.integration.test.tsx`
- Modify: `apps/web/src/components/admin/admin-panel.tsx`
- Modify: `apps/web/src/components/admin/admin-panel.integration.test.tsx`
- Modify: `apps/web/src/server/auth/player-session.ts`
- Modify: `apps/web/src/server/auth/player-session.test.ts`

**Interfaces:**
- Produces:

```ts
export async function createPlayerSession(nickname: string): Promise<{ playerId: string }>;
export async function joinCurrentGame(): Promise<{ gameId: string }>;
export async function postQuestion(content: string): Promise<PublicMessage>;
export async function fetchCurrentGame(): Promise<PublicGameSnapshot | null>;
```

- [ ] **Step 1: Write failing real-wiring tests**

Test generated UUID idempotency keys, credentials/same-origin requests, nickname then join, server PENDING replacing local SENDING, error cleanup, snapshot refresh, admin login/create/status/retry calls, and zero `demoSnapshot`/`demo` usage in production pages.

- [ ] **Step 2: Render the real initial snapshot**

The server page reads the signed player cookie without exposing it, obtains `getCurrentSnapshot(getDb(), playerId)`, and renders `GameClient` with the real snapshot/player ID. An unauthenticated visitor sees the nickname gate. Do not query `private` from the browser.

- [ ] **Step 3: Wire default client actions to the Route Handlers**

Keep injectable callbacks for tests, but production defaults call `game-api.ts`. After nickname creation, join the current game and refresh the snapshot. Question submission replaces SENDING with the returned PENDING row and lets Realtime invalidation publish the verdict.

- [ ] **Step 4: Wire the admin preparation slice**

Remove admin demo mode. Login, create/replace preparation, status polling, and extraction retry call existing handlers. Until the following phase implements final answer/force end, render those controls disabled with explicit unavailable copy; never simulate success locally.

- [ ] **Step 5: Verify and commit UI wiring**

Run all web tests, typecheck, lint, and production build under Node.js 22. Confirm the browser bundle contains no server URLs/secrets/solution/key points. Commit:

```powershell
git commit -m "feat: connect the dashboard to the live game loop"
```

## Task 7: Narrow Runtime Privileges and Prove the Phase

**Files:**
- Create via CLI: migration ending `_narrow_runtime_permissions.sql`
- Modify: `supabase/tests/database/002_security.test.sql`
- Modify: `docs/operations/database-roles.md`
- Create: `scripts/verify-first-playable-loop.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: least-privilege `game_web`/`judge_worker` access and one repeatable local acceptance command.

- [ ] **Step 1: Create the migration through the CLI**

Run:

```powershell
pnpm exec supabase migration new narrow_runtime_permissions
```

Use the exact generated filename. Revoke the current blanket grants/policies, then grant only operations exercised by this phase. In particular, `judge_worker` must not access player identities, admin audits, request idempotency, or rate-limit buckets; `game_web` must not write verdicts, key-point claims, judge attempts, or Worker heartbeats.

- [ ] **Step 2: Expand positive and negative role tests**

For each role, test one allowed read/write per responsibility and explicit rejection of the sensitive cross-role operations above. Keep anon/authenticated public SELECT-only assertions and private-schema rejection.

- [ ] **Step 3: Add a repeatable Fake-Judge acceptance script**

The script must reset local data, start web/Worker processes with local-only test credentials, create an admin session and puzzle, wait for ACTIVE, create two player sessions, submit ordered questions, wait for JUDGED rows, and assert sequence, verdict, score, first-hit claim, counters, and private-data absence from HTTP responses. It must always terminate child processes in `finally`.

- [ ] **Step 4: Run the complete phase gate**

Run under Node.js 22:

```powershell
pnpm exec supabase db reset
pnpm exec supabase test db --local
pnpm test
pnpm typecheck
pnpm --filter @turtle-soup/web lint
pnpm build
docker run --rm turtle-soup-harness-spike
docker build -f services/judge-worker/Dockerfile -t turtle-soup-judge-worker .
node scripts/verify-first-playable-loop.mjs
git diff --check
```

Expected: every command exits 0; the API acceptance uses two players and produces exactly-once ordered scoring; public payloads contain no solution/key points; the worktree contains only intentional changes.

- [ ] **Step 5: Commit phase verification**

```powershell
git add -- supabase/migrations supabase/tests/database/002_security.test.sql docs/operations/database-roles.md scripts/verify-first-playable-loop.mjs package.json pnpm-lock.yaml
git diff --cached --name-only
git commit -m "test: verify the first playable judge loop"
```

---

## Phase Exit Criteria

- Harness decision is GO with a passing Docker probe, or the phase is explicitly limited to Fake Judge with a recorded NO-GO blocker.
- A real admin preparation becomes ACTIVE through the extraction Worker without manual database edits.
- A real signed player can join and submit a question through the browser.
- The public message appears PENDING immediately and later becomes JUDGED on the same row.
- Receipt ordering, first-hit claims, score, progress, question count, and YES-only hit-rate numerator pass unit/database/integration tests.
- Browser/Admin production pages contain no demo data or simulated successful mutations.
- Runtime roles have least-privilege tests, and anon cannot read private data or mutate public tables.
- Web and Worker tests/typecheck/build pass under Node.js 22; both required Docker images build.

## Work Remaining After This Phase

1. Final-answer receipt, private body storage, semantic coverage, deterministic 4/4 success, failure events, +2 winner score, reveal, and later-action cancellation.
2. Force-end race handling and admin retry of the blocked action head.
3. Final-answer/admin UI wiring and the ended-game reveal experience.
4. Full two-browser Playwright suite, privacy/bundle audit, crash/lease recovery test, and 10-active-player load verification.
5. Production environment provisioning, Supabase/Vercel/Worker deployment docs, observability, rollback, and real-provider benchmark evidence.

## Self-Review Checklist

- Every task ends in an independently reviewable commit.
- Existing RED Task-12 tests are retained and completed in Task 3.
- Extraction, normal-question receipt, atomic scoring, Worker composition, and UI wiring each have explicit ownership.
- No final-answer implementation is hidden inside this phase.
- No step treats Fake Judge as proof that the real Harness works.
- All success claims require fresh commands and Node.js 22 evidence.
