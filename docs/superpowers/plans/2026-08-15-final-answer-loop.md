# Final-answer loop implementation plan

> Execute this plan in the current approved `master` checkout. Follow TDD for
> each task: write a failing test, run it, implement the smallest change, then
> run the focused verification before committing.

## Scope and success criteria

Implement the approved design in
`docs/superpowers/specs/2026-08-15-final-answer-loop-design.md` without changing
normal-question scoring or adding rooms/history. Success means a real player can
submit a private final answer, the serial Worker can fail or atomically finish
the game, an admin can retry a blocked head or force end, and all public clients
see only safe events/reveal data.

## Task 1 — Lock the database lifecycle and runtime boundaries

**Files:** create one new migration; modify database pgTAP tests and runtime-role
documentation.

1. Add failing pgTAP assertions for final-answer receipt columns, event/reveal
   inserts, all-or-nothing end state, force-end cancellation, and the race where
   an ended game rejects a Worker completion.
2. Add the narrow grants/policies required by the web force-end/receipt path and
   Worker final-answer read/complete path. Keep browser roles unable to read
   `private.final_answer_submissions.answer` and keep Worker unable to write
   request idempotency/rate-limit/player-identity tables.
3. Implement the migration and document the exact table operations.
4. Run `pnpm exec supabase db reset` and the focused database/security suites;
   commit `feat: prepare final-answer database boundaries`.

## Task 2 — Add the private final-answer receipt route

**Files:** create `apps/web/src/server/game/submit-final-answer.ts`, its tests,
`apps/web/src/app/api/game/current/final-answers/route.ts`, and route tests; add
the client API function and tests.

1. Write RED tests for trimming/length/control validation, missing player or
   idempotency key, stale Worker, WAITING/ENDED rejection, same-key replay,
   sequence allocation after normal messages, and a response that contains only
   submission ID/sequence/status.
2. Implement the transaction with a game-row lock, private action/submission
   inserts, and no public message row. Use the existing HMAC idempotency claim
   and final-answer rate-limit configuration.
3. Verify no answer text appears in response/error/query logging and run focused
   web tests/typecheck; commit `feat: accept private final answers`.

## Task 3 — Implement Worker final-answer judging and atomic completion

**Files:** create final-answer processor/completion modules and tests; modify the
action dispatcher/exports; add database lifecycle/scoring tests.

1. Replace the intentional `FINAL_ANSWER_UNAVAILABLE` RED expectation with RED
   dispatch/processor tests. Cover private input isolation, final judge output,
   3/4 failure, 4/4 success, unknown/duplicate IDs, lease loss, and retry codes.
2. Implement `processFinalAnswer` outside the transaction and
   `completeFinalAnswer` with stable locking, allow-list validation, failure
   event, success +2/winner/end/reveal/cancellation, and exact-once guards.
3. Dispatch `FINAL_ANSWER` through the same retry path as normal actions.
4. Run Worker tests/typecheck/build and local pgTAP; commit
   `feat: complete final-answer judging`.

## Task 4 — Add admin retry and force-end transactions/routes

**Files:** modify `admin-lifecycle.ts` and tests; create the two admin route
handlers/tests; update API error/response types and `game-api.ts`.

1. Write RED tests for blocked-head retry, active-only force end, force-end
   reveal/event/cancellation, idempotent replay, and the no-op second force end.
2. Implement short locked transactions. Force end must never award points and
   must make a Worker completion after the race a no-op.
3. Add same-origin/admin-session/rate-limit/idempotency route protections and
   safe response bodies; commit `feat: add admin end-game controls`.

## Task 5 — Wire the player/admin UI and public event rows

**Files:** modify `GameClient`, `MessageFeed`, admin panel/status controls, and
their tests; add/update event-row component/styles only where necessary.

1. Write RED UI tests for live final-answer submission, volatile local answer
   retention, matching failure/success events, ended-state disabling, reveal,
   public event rendering without answer text, and enabled admin controls.
2. Wire default API calls while preserving injectable test adapters. Associate a
   receipt sequence with local answer state; never persist it in browser storage.
3. Add retry-blocked action display without exposing queue/private details.
4. Run all web tests, typecheck, lint, and build; commit
   `feat: wire final-answer and end-game UI`.

## Task 6 — Expand acceptance and perform the phase gate

**Files:** modify the local acceptance script, security/lifecycle tests, docs,
and package scripts only if needed.

1. Extend the Fake-Judge acceptance to run failed and successful final answers,
   assert exact-once +2, event/reveal visibility, later-action cancellation,
   force-end no-score behavior, and absence of private answer text in HTTP.
2. Add a deterministic 10-player concurrent receipt smoke test (within the
   existing single-game design; no admission cap).
3. Run `supabase db reset`, all pgTAP, all package tests, typechecks, web lint,
   build, Docker worker build, acceptance, and `git diff --check`.
4. Review staged paths and commit `test: verify the final-answer game loop`.

## Explicit non-goals

- No production provider benchmark, deployment, observability, or Playwright
  multi-browser suite in this phase.
- No challenge/rejudge feature, rooms, game history navigation, or score-rule
  changes.
- Do not fix unrelated root ESLint configuration or generated Next artifacts.

