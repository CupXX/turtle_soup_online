# All Choices Correct Question Judge v6 — 30-case, 2-configuration, 5-round comparison

- Generated: 2026-08-15T17:27:25.603Z
- Fixture: services/judge-worker/benchmarks/fixtures/all-choices-correct-question-judge-v1-30cases.json
- Prompt: question-judge-v6
- Schema: judge-schema-v1
- Rounds: 5
- Attempts: 300
- Frozen commit: e5c5fb716d9ed246e20f48b9b380ad3e62de92c3

## Fixed key points

- KP1: 所谓的“选择题”实际是凶手让被害人的母亲猜她的孩子在哪个房间。
- KP2: 被害人的尸体已经被分尸。
- KP3: 尸块被分散藏在多个不同房间，因此母亲无论选择哪个房间，都能被凶手说成答对。

## Configuration comparison

| Configuration | Attempts | Valid | Verdict accuracy | KP coverage accuracy | Strict joint accuracy | Valid verdict accuracy | Valid KP coverage accuracy | Avg ms | P50 ms | P95 ms | Input tokens | Output tokens | Cost USD | Failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| GPT-5.6 Luna / none | 150 | 150 | 97.3% | 82.7% | 80.0% | 97.3% | 82.7% | 1309.8 | 1209.0 | 1916.0 | 328825 | 4454 | N/A | RELEVANCE_QUESTION_FAILURE=1, SEMANTIC_ENTAILMENT_FAILURE=3, KP_OVER_TRIGGER=11, KP_WRONG_ID=10, MULTI_KP_FAILURE=5 |
| GPT-5.6 Luna / medium | 150 | 150 | 97.3% | 91.3% | 88.7% | 97.3% | 91.3% | 2214.1 | 1761.0 | 5410.0 | 328825 | 23986 | N/A | SEMANTIC_ENTAILMENT_FAILURE=3, SURFACE_INTERPRETATION_FAILURE=1, KP_UNDER_TRIGGER=6, KP_WRONG_ID=3, MULTI_KP_FAILURE=4 |

## Overall

- Verdict accuracy: 97.3% (292/300)
- Key-point coverage accuracy: 87.0% (261/300)
- Strict joint accuracy: 84.3% (253/300)
- Valid result rate: 100.0%
- Latency: average 1762.0 ms, P50 1377.0 ms, P95 3765.0 ms
- Token/cost fields are authoritative provider values only; absent values remain N/A.

## Actual verdict distribution

| Configuration | YES | NO | BOTH | IRRELEVANT | Invalid |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT-5.6 Luna / none | 77 | 41 | 5 | 27 | 0 |
| GPT-5.6 Luna / medium | 78 | 41 | 5 | 26 | 0 |

## Per-case stability

| Case | Expected verdict | Expected KP | Verdict accuracy | KP coverage accuracy | Strict joint accuracy | Failures |
| --- | --- | --- | ---: | ---: | ---: | --- |
| school_exam | NO | — | 100.0% | 100.0% | 100.0% | none |
| on_test_paper | NO | — | 90.0% | 100.0% | 90.0% | SURFACE_INTERPRETATION_FAILURE=1 |
| tv_quiz | NO | — | 100.0% | 100.0% | 100.0% | none |
| unique_standard_answer | NO | — | 100.0% | 100.0% | 100.0% | none |
| identical_options | NO | — | 100.0% | 100.0% | 100.0% | none |
| arbitrary_grading | NO | — | 80.0% | 100.0% | 80.0% | SEMANTIC_ENTAILMENT_FAILURE=2 |
| school_related | NO | — | 100.0% | 100.0% | 100.0% | none |
| options_are_locations | YES | — | 100.0% | 60.0% | 60.0% | KP_OVER_TRIGGER=4 |
| asks_location | YES | — | 100.0% | 100.0% | 100.0% | none |
| room_related | YES | — | 100.0% | 100.0% | 100.0% | none |
| multiple_options_true | YES | — | 100.0% | 100.0% | 100.0% | none |
| four_options | IRRELEVANT | — | 100.0% | 100.0% | 100.0% | none |
| object_matches_multiple_options | YES | — | 100.0% | 90.0% | 90.0% | KP_OVER_TRIGGER=1 |
| choice_changes_reality | NO | — | 60.0% | 100.0% | 60.0% | SEMANTIC_ENTAILMENT_FAILURE=4 |
| answerer_adult | IRRELEVANT | — | 100.0% | 100.0% | 100.0% | none |
| death_related | YES | — | 100.0% | 100.0% | 100.0% | none |
| corpse_related | YES | — | 100.0% | 100.0% | 100.0% | none |
| dismemberment_related | YES | — | 100.0% | 90.0% | 90.0% | KP_OVER_TRIGGER=1 |
| someone_dismembered | YES | KP2 | 100.0% | 70.0% | 70.0% | KP_UNDER_TRIGGER=3 |
| body_parts_different_places | YES | KP2 | 100.0% | 10.0% | 10.0% | KP_UNDER_TRIGGER=2, KP_WRONG_ID=7 |
| culprit_glasses | IRRELEVANT | — | 100.0% | 100.0% | 100.0% | none |
| body_parts_different_rooms | YES | KP2 | 100.0% | 0.0% | 0.0% | KP_UNDER_TRIGGER=1, KP_WRONG_ID=6, MULTI_KP_FAILURE=3 |
| distributed_rooms_explain_all_correct | YES | KP2, KP3 | 100.0% | 40.0% | 40.0% | MULTI_KP_FAILURE=6 |
| questioner_is_murderer | YES | — | 100.0% | 50.0% | 50.0% | KP_OVER_TRIGGER=5 |
| mother_guesses_child_room | YES | KP1 | 100.0% | 100.0% | 100.0% | none |
| full_solution_chain | YES | KP1, KP2, KP3 | 100.0% | 100.0% | 100.0% | none |
| answerer_job_related | NO | — | 90.0% | 100.0% | 90.0% | RELEVANCE_QUESTION_FAILURE=1 |
| questioner_gender | IRRELEVANT | — | 100.0% | 100.0% | 100.0% | none |
| happened_at_night | IRRELEVANT | — | 100.0% | 100.0% | 100.0% | none |
| is_really_choice_question | BOTH | — | 100.0% | 100.0% | 100.0% | none |

## Interpretation

- Verdict correctness and key-point coverage are measured independently. A correct YES with no KP and a BOTH result with coverage from its true proposition are valid outcomes by design.
- Surface-framing misses are reported separately from generic semantic misses; KP over/under-trigger and multi-KP errors remain separate from verdict errors.
- Consistent errors across both reasoning settings suggest a policy/gold issue; errors concentrated in Luna none or varying by round are model-capability/stability observations.
- This is a controlled single-puzzle capability comparison. It does not by itself authorize permanent model routing changes.
