# Cumulative Evidence implementation plan

1. Add contract types and strict schemas for nested extraction Evidence and
   Evidence-mode question judging; keep legacy result validation intact.
2. Add the Evidence table, judgment/challenge columns, indexes, immutable
   trigger, worker grants, RLS, and migration tests.
3. Extend extraction prompts and completion to store Evidence atomically with
   key points.
4. Add a pure deterministic progress reducer with tests for cross-round,
   multi-player completion, duplicate prevention, and challenge rollback.
5. Extend question/challenge processors and DB completion paths to use the
   Evidence reducer when a game has Evidence definitions, while preserving the
   legacy path for old games.
6. Add the 41-message production regression fixture and deterministic expected
   trigger assertions.
7. Run contracts, game-core, worker, web, database tests, build/typecheck, and
   a production read-only snapshot before the authorized production migration
   and replay.
8. Apply the migration and approved Evidence definitions to the target game,
   replay its current judgments in sequence, and verify claims, awards, score,
   discovered count, and compatibility coverage without changing question
   text or verdicts.
