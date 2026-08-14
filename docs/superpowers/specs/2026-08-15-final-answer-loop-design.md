# Final-answer loop design

**Date:** 2026-08-15  
**Status:** Approved for implementation in this task

## Goal

Finish the first playable loop by adding private final-answer receipts, serial
semantic judging, deterministic all-key-point success, public end-game reveal,
and a safe administrator force-end/retry path. The existing one-game, serial
queue, privacy, and scoring architecture stays unchanged.

## Decisions and assumptions

- A final answer is a `private.game_actions` row with `action_type = FINAL_ANSWER`
  and the same per-game `sequence_no` space as normal messages.
- The API returns only `{ submissionId, sequenceNo, status: "PENDING" }`. It
  never returns the submitted answer or any model result. The answer remains in
  the private table and, while the page is open, in volatile React state.
- The final-answer judge returns only covered key-point IDs. The server compares
  the de-duplicated allow-listed IDs to every fixed key point; the model cannot
  end a game or award points.
- A failed final answer completes its action and inserts one public
  `FINAL_ANSWER_FAILED` event at that action's sequence. It does not change
  score, question statistics, or discovered progress, and the game remains
  `ACTIVE`.
- The first successful final answer completes in one transaction: it awards
  exactly `+2` lifetime score, sets the winner, marks the game `ENDED` with
  `FINAL_ANSWER_SUCCESS`, inserts the success event and reveal, and cancels all
  later incomplete actions. A repeated completion is a no-op.
- Force end is an administrator-only transaction. It is allowed only for an
  `ACTIVE` game, awards no points, inserts a `FORCE_ENDED` event, copies the
  private solution/key points to the public reveal tables, marks the game
  `ENDED`, and cancels every incomplete action. A Worker result that races with
  it must fail its action/game re-check and cannot publish score or verdict.
- Force-end event ordering uses the next sequence after the latest queued action
  (or `1` when no action exists). This keeps event ordering deterministic while
  preserving the receipt sequence of player actions.
- A blocked action head can be returned to `RETRY` by an authenticated admin.
  Retry and force-end are idempotent at the HTTP boundary and require the
  existing admin rate limit and same-origin/idempotency protections.
- After `ENDED`, both player submission routes reject before persistence. Public
  snapshots continue to serve history and the reveal; private final-answer
  bodies remain unreadable through HTTP and Realtime.

## Components

### Web receipt boundary

`submit-final-answer.ts` mirrors the normal-message receipt boundary: it checks
the fresh Worker heartbeat, locks the current game, verifies `ACTIVE`, returns a
matching action for an idempotent retry, allocates the next sequence, inserts a
private submission and action, and returns the safe receipt. The route performs
same-origin, signed player session, JSON/body validation, final-answer rate
limit, HMAC idempotency claim, and result binding.

### Worker boundary

`final-answer-processor.ts` loads only the current private answer and fixed key
points, calls `SemanticJudge.judgeFinalAnswer` outside a transaction, and passes
only validated IDs to `completeFinalAnswer`. The completion transaction locks
the action and game, checks the live lease and `ACTIVE` state, validates IDs,
and then executes the success/failure branch above. It never stores prompts,
raw model output, missing-key explanations, or answer text in public tables.

### Admin lifecycle boundary

`forceEndGame` and `retryBlockedAction` live beside the existing preparation
lifecycle. Force end reads the current private solution/key points inside the
transaction and writes the public reveal. The admin routes expose only safe
status/operation results; the admin page enables controls only for the relevant
game/queue state.

### Frontend

The final-answer button is enabled on the real page. The modal submits through
the live API and associates the returned sequence with a volatile local answer.
Public events are rendered as rows without answer text. On a matching failure
event the submitting browser may show its own retained answer; on success it
clears it. When the snapshot becomes `ENDED`, both composers are disabled and
the existing reveal panel shows the solution and ordered key points.

## Data and security invariants

- `private.final_answer_submissions.answer` is never selected by a browser
  route, public query, Realtime payload, log, or error message.
- Only the server role inserts/cancels receipts; only the Worker completes a
  final-answer action and changes player score. Runtime grants are extended
  only for the exact tables needed by the new transaction paths.
- Every final-answer completion and force-end transaction re-checks game state
  after model/admin work. No late Worker result can mutate an ended game.
- The final-answer success predicate is `coveredIds === allKeyPointIds` after
  allow-list validation and de-duplication. Three of four is failure; four of
  four is success.

## Verification contract

The phase is complete only when all of the following are green:

1. Game-core and Worker unit tests cover 3/4 failure, 4/4 success, invalid IDs,
   retry mapping, exact-once +2, reveal/cancellation, and ended-game races.
2. Web unit/route tests cover private receipt shape, idempotent replay,
   validation/rate limits, ended rejection, event-driven local UI state, and
   admin force-end/retry controls.
3. Supabase pgTAP covers reveal/event/cancellation atomicity and runtime-role
   grants/rejections.
4. `pnpm test`, typecheck, web lint/build, local database tests, and the
   Fake-Judge acceptance script pass. Public HTTP payloads contain no final
   answer or private key-point text before game end.

