# Cumulative Evidence Key-Point Discovery

## Goal

Allow several natural yes/no questions, possibly from different players, to
complete one meaningful key-point milestone. A question judge identifies the
pre-defined atomic Evidence established by the current question and its final
verdict. Application code, not the model, decides when a key point is complete.

The existing verdict semantics and final-answer flow remain unchanged.

## Data model

Each extracted key point keeps its existing content and receives one or more
hidden Evidence rows:

`private.key_point_evidence(id, key_point_id, ordinal, content, created_at)`

Evidence is immutable once the game is active. It is only visible to the judge
worker. A key point is complete when every Evidence ID belonging to it appears
in the cumulative set of valid current question judgments.

`private.question_judgments` retains all existing coverage arrays for backward
compatibility and adds:

- `original_established_evidence_ids`
- `current_established_evidence_ids`

Challenge audit rows store `established_evidence_ids`, and the resolved
challenge stores `resolved_established_evidence_ids`.

The old arrays remain populated as a compatibility projection: in Evidence
mode they contain only the key points that became complete for the first time
on that message. Games without Evidence rows continue using the legacy
single-message coverage mode.

## Judge contracts

Extraction returns 3–5 milestones, each with 1–4 atomic Evidence facts. The
prompt explicitly forbids unsupported motives, causes, outcomes, or facts that
are already public.

Question judging uses one structured call. Phases A–C still determine the
verdict. Phase D then selects only Evidence IDs that are genuinely established
by `current_message + verdict`; a negative verdict may establish a pre-defined
negative Evidence fact. In Evidence mode the response is
`{ verdict, established_evidence_ids }`. Legacy games continue to use
`{ verdict, fully_covered_key_point_ids }`.

## Deterministic progress and scoring

After each Evidence judgment and after each resolved challenge, the worker:

1. reads all current judgments in message sequence order;
2. accumulates Evidence IDs;
3. marks a key point complete at the first message whose cumulative set
   contains all of its required Evidence;
4. rebuilds first-owner claims, message awards, player lifetime-score deltas,
   discovered count, and compatibility coverage arrays.

This same pure progress reducer is used by tests and by both write paths. It
means challenge/rejudge can remove or move a discovery without stale permanent
state.

## Production compatibility and regression

The existing production game remains in legacy mode until its Evidence
definition is explicitly created. For the authorized rejudge, Evidence rows
will be created from the approved four milestones, then the 41 current
judgments will be replayed in sequence. No historical question text, verdict,
or solution text is changed; only derived Evidence arrays, claims, awards,
scores, and counts are rebuilt.

The regression fixture expects the homicide/wife milestone to complete when
the later spouse question arrives, the bathtub/ice milestone to complete when
the later bathtub question arrives, and the late preservation/smell milestone
to complete after its contributing questions. It does not encode any
puzzle-specific production branch.
