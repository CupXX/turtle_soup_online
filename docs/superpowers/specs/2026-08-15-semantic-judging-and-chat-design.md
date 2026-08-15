# Semantic judging and player-chat design

**Date:** 2026-08-15
**Status:** Approved for implementation planning

## Goal

Stabilize Turtle Soup semantics before choosing a permanent model, using the
mosquito puzzle as one controlled regression fixture. In the same scoped phase,
standardize player-facing terminology, expose extracted key points read-only to
administrators, preserve immediate public message delivery, and present player
messages as chat bubbles without making the AI a conversational participant.

The existing one-game lifecycle, serial action queue, deterministic scoring,
private final-answer boundary, and frozen ACTIVE-game key points remain intact.

## Canonical puzzle and terminology

The controlled fixture is:

- 汤面：`一个人半夜醒来打了自己一巴掌，然后闻着一股燃烧的味道安心睡去了，请问发生了什么？`
- 汤底：`这个人被蚊子叮醒，打了一下没打着，然后点起了蚊香。`

All player-visible and administrator-visible copy uses these terms:

- `汤面` means the public puzzle surface.
- `汤底` means the canonical full solution supplied by the administrator and
  revealed when the game ends.
- `正答` means a player's submitted reconstruction of the story.
- `关键点` means a hidden semantic fact or relationship required to reconstruct
  the canonical solution.

Internal contracts and database names such as `puzzleSurface`, `fullSolution`,
and `finalAnswer` remain unchanged. This avoids an unrelated schema/API rename.

Public final-answer events render as:

- `<昵称> 提交了正答：❌ 失败`
- `<昵称> 提交了正答：✅ 成功`

Failed submission text remains private. Public payloads must not expose the
submitted content, missing key-point count or IDs, explanations, or hints.

## Fixed key points and regression expectations

The extraction policy should produce exactly three semantic facts for the
controlled fixture, allowing wording differences but not semantic differences:

1. He was awakened by a mosquito biting him.
2. The slap was intended to hit the mosquito, and it missed.
3. He then lit a mosquito coil.

The fixture assigns stable test UUIDs `KP1`, `KP2`, and `KP3` to these facts
after extraction so every model receives identical IDs and semantic inputs.

The fixed question suite is:

| Question | Expected verdict | Expected full coverage |
| --- | --- | --- |
| 这个人死了吗？ | `NO` | none |
| 故事里还有第二个人吗？ | `NO` | none |
| 是不是有蚊子？ | `YES` | none |
| 是不是打蚊子？ | `YES` | none |
| 是不是点了蚊香？ | `YES` | `KP3` |
| 是不是蚊子把他弄醒的？ | `YES` | `KP1` |
| 他这一巴掌是在打蚊子，但是没打中吗？ | `YES` | `KP2` |

The expected verdict and coverage never change between model configurations.

## Semantic judging policy

Question judging performs two independent operations:

1. Classify the current message as `YES`, `NO`, `BOTH`, or `IRRELEVANT` from the
   canonical solution.
2. Return only fixed key-point IDs fully covered by the current message.

Verdict does not imply score. A message may be `YES` and cover no key point.
The model reports semantic coverage; deterministic completion code continues to
decide whether a point was previously undiscovered, first-hit ownership, and
whether `+1` is awarded.

The production prompt defines:

- `YES`: the message's core semantic claim is true according to the solution;
  paraphrases and useful partial facts count.
- `NO`: the core semantic claim is false according to the solution.
- `BOTH`: the message contains material true and false claims, or has intrinsic
  ambiguity with two explicit reasonable interpretations that yield opposite
  answers. It is not an uncertainty fallback.
- `IRRELEVANT`: the requested information does not meaningfully bear on
  reconstructing this puzzle. It is not synonymous with no key-point coverage.

Relationship questions answer the relationship directly. If an entity is
related, the relationship question is normally `YES`; if not, it is `NO`.

A key point is covered only when a `YES` answer confirms every material fact in
that key point. Entity-only, action-only, target-only, or outcome-only matches
remain partial. Questions phrased as yes/no questions may cover a key point when
the affirmative answer confirms the complete fact.

## Key-point extraction policy

The production extraction prompt requires exactly 3–5 key points. Every point:

- represents a hidden fact or relationship needed to reconstruct the solution;
- is supported by the canonical solution;
- avoids restating information already directly disclosed in the surface;
- is atomic and non-overlapping without mechanically splitting one fact;
- preserves actors, actions, targets, outcomes, causes, or purposes only when
  they materially distinguish the solution;
- contains no invented story details.

The controlled extraction candidate is `deepseek-v4-pro` with reasoning effort
`high`. The extraction is run before the question comparison; its three fixed
semantic results become the identical key-point input to every compared model.
The existing database rule that ACTIVE-game key points are immutable remains
the source of truth and receives a regression check rather than a redesign.

## Controlled model comparison

The corrected production prompt and fixed fixture are run against:

1. `deepseek-v4-flash`, thinking disabled.
2. `deepseek-v4-pro`, thinking disabled.
3. `deepseek-v4-pro`, reasoning effort `high`.

For every model/question pair, the report records:

- returned verdict and covered key-point IDs;
- independent verdict correctness and coverage correctness;
- schema validity;
- end-to-end invocation latency;
- input/output token usage and cost only when reliably returned by the provider
  or Harness. Unavailable usage or pricing is reported as `N/A`, not estimated.

The comparison produces separate verdict and coverage accuracy totals. It does
not itself set a permanent production model. The report interprets remaining
failures as prompt/policy or model-capability failures and recommends the next
experiment.

## Independent runtime configuration

Key-point extraction, question judging, and final-answer judging each receive
an independent model and reasoning setting. The current global model remains a
compatibility fallback so existing environments continue to start.

The implementation should add only the smallest routing layer needed to create
three `SemanticJudge` paths from those settings. It must not fork the queue,
duplicate processors, or introduce a new provider abstraction.

## Model-call audit

The existing `private.judge_attempts` boundary is connected to actual
invocations. It records:

- skill type/version, provider, model, and reasoning setting;
- prompt and schema versions;
- latency, token usage when available, validity, and safe error code;
- `action_id` for question/final-answer work or `extraction_job_id` for
  extraction work.

An action's existing `result_resource_id` resolves its associated message, so a
duplicated `message_id` column is unnecessary. The audit never stores puzzle
surface, canonical solution, submitted answer, prompt body, raw output, or
hidden chain-of-thought/reasoning. It is private and unavailable through public
HTTP or Realtime.

## Administrator key-point display

The authenticated admin status boundary returns ordered key-point ordinals and
content for the current game. The admin panel renders them read-only for
extraction testing and debugging. This phase adds no editing, approval,
reordering, or activation gate.

## Player message flow and presentation

The existing message ordering remains:

1. The submitting browser immediately renders a local `SENDING` message.
2. The web transaction inserts an `api.messages` row with `PENDING` before the
   Worker can claim the corresponding action.
3. Realtime invalidates every connected player's snapshot, making the PENDING
   message visible before judgment.
4. The Worker updates the same message with verdict, reaction, and points.

No new messaging transport is introduced. A two-client acceptance test pauses
or controls judgment long enough to prove the second client sees `PENDING`
before the verdict.

Player messages render as chat bubbles:

- the current player's bubbles align right;
- other players' bubbles align left;
- desktop bubbles occupy at most about 50% of the message region;
- mobile bubbles may be wider for readability;
- verdict, reaction, status, and points remain visually attached to the same
  player message.

The AI never receives a nickname, public player identity, standalone message,
or chat bubble. Public final-answer outcomes remain system events, not AI turns.

## Scope boundaries

This phase does not add model training, fine-tuning, manual key-point editing,
an approval workflow, a second queue, raw model-output persistence, public audit
data, AI chat participation, or a broad component/database rename.

## Verification contract

The phase is complete only when all of the following are verified:

1. Extraction produces the three intended mosquito-puzzle semantics and no
   redundant surface-restatement point.
2. The seven-question suite runs unchanged against all three configurations and
   produces a concise comparison report with separate verdict and coverage
   accuracy, schema validity, latency, and available usage/cost.
3. Prompt unit tests cover verdict/coverage independence, partial coverage,
   relationship questions, and strict `BOTH`/`IRRELEVANT` behavior.
4. Runtime tests prove independent per-skill model/reasoning selection with the
   current global fallback.
5. Audit tests and database tests prove one safe metadata record per attempt,
   private access, correct action/job association, and no prompt/solution/raw
   reasoning storage.
6. Web tests verify `汤面`/`汤底`/`正答`/`关键点` copy, read-only admin key points,
   exact public final-answer event wording, private failure content, player-side
   alignment, and reaction attachment.
7. A two-client acceptance test proves that a PENDING player message becomes
   public before its judged update and that no AI bubble is rendered.
8. Relevant unit suites, typechecks, web lint/build, Worker build, database
   pgTAP, and browser smoke checks pass. Existing unrelated lint/tooling failures
   are reported separately rather than hidden or expanded into this scope.
