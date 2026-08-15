# Mosquito Question Judge v4 — 25-case, 6-configuration, 5-round comparison

- Generated: 2026-08-15T11:34:30.673Z
- Fixture: services/judge-worker/benchmarks/fixtures/mosquito-question-judge-v4-25cases.json
- Prompt: question-judge-v3
- Schema: judge-schema-v1
- Rounds: 5
- Attempts: 750
- Frozen commit: bea9a8f

## Fixed key points

- KP1: 他半夜醒来是因为被蚊子叮醒。
- KP2: 他打自己一巴掌是为了拍蚊子，但没有打着。
- KP3: 他随后点燃了蚊香。

## Configuration comparison

| Configuration | Attempts | Valid | Verdict accuracy | Valid verdict accuracy | KP coverage accuracy | Valid KP coverage accuracy | Avg ms | P50 ms | P95 ms | Input tokens | Output tokens | Failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| DeepSeek Flash / off | 125 | 125 | 80.0% | 80.0% | 79.2% | 79.2% | 3325.8 | 3293.0 | 3743.0 | N/A | N/A | SEMANTIC_ENTAILMENT_FAILURE=11, BOTH_MIXED_PROPOSITION_FAILURE=3, BOTH_AMBIGUITY_FAILURE=11, KP_OVER_TRIGGER=24, KP_UNDER_TRIGGER=2 |
| DeepSeek Flash / high | 125 | 115 | 83.2% | 90.4% | 87.2% | 94.8% | 11097.4 | 7905.0 | 30005.0 | N/A | N/A | UNKNOWN_VS_FALSE_FAILURE=4, SEMANTIC_ENTAILMENT_FAILURE=5, BOTH_AMBIGUITY_FAILURE=2, KP_OVER_TRIGGER=3, KP_UNDER_TRIGGER=2, MULTI_KP_FAILURE=1, TRANSPORT_FAILURE=10 |
| DeepSeek Pro / off | 125 | 125 | 84.0% | 84.0% | 92.8% | 92.8% | 4048.9 | 3977.0 | 4658.0 | N/A | N/A | UNKNOWN_VS_FALSE_FAILURE=6, SEMANTIC_ENTAILMENT_FAILURE=4, BOTH_AMBIGUITY_FAILURE=10, KP_OVER_TRIGGER=8, KP_UNDER_TRIGGER=1 |
| DeepSeek Pro / high | 125 | 88 | 65.6% | 93.2% | 69.6% | 98.9% | 13804.6 | 10267.0 | 30011.0 | N/A | N/A | UNKNOWN_VS_FALSE_FAILURE=2, SEMANTIC_ENTAILMENT_FAILURE=1, BOTH_AMBIGUITY_FAILURE=3, KP_UNDER_TRIGGER=1, SCHEMA_FAILURE=7, TRANSPORT_FAILURE=30 |
| GPT-5.6 Luna / none | 125 | 125 | 88.8% | 88.8% | 88.0% | 88.0% | 1329.9 | 1256.0 | 1864.0 | 103130 | 3992 | SEMANTIC_ENTAILMENT_FAILURE=10, BOTH_AMBIGUITY_FAILURE=4, KP_OVER_TRIGGER=11, KP_UNDER_TRIGGER=4 |
| GPT-5.6 Luna / medium | 125 | 125 | 88.8% | 88.8% | 96.0% | 96.0% | 2313.4 | 1978.0 | 4065.0 | 103130 | 18833 | SEMANTIC_ENTAILMENT_FAILURE=10, BOTH_AMBIGUITY_FAILURE=4, KP_OVER_TRIGGER=3, KP_UNDER_TRIGGER=2 |

## Overall

- Verdict accuracy: 81.7% (613/750)
- Key-point coverage accuracy: 85.5% (641/750)
- Valid result rate: 93.7%
- Latency: average 5986.7 ms, P50 3710.0 ms, P95 24626.0 ms
- Token/cost fields are authoritative provider values only; absent values remain N/A.

## Case stability and failure categories

| Case | Expected verdict | Expected KP | Verdict accuracy | KP coverage accuracy | Failures |
| --- | --- | --- | ---: | ---: | --- |
| dead | NO | — | 16.7% | 86.7% | SEMANTIC_ENTAILMENT_FAILURE=21, TRANSPORT_FAILURE=4 |
| second-person | NO | — | 50.0% | 93.3% | SEMANTIC_ENTAILMENT_FAILURE=13, TRANSPORT_FAILURE=2 |
| disability | IRRELEVANT | — | 96.7% | 100.0% | UNKNOWN_VS_FALSE_FAILURE=1 |
| self-hate | IRRELEVANT | — | 56.7% | 93.3% | UNKNOWN_VS_FALSE_FAILURE=11, TRANSPORT_FAILURE=2 |
| gender | IRRELEVANT | — | 96.7% | 96.7% | TRANSPORT_FAILURE=1 |
| self-hate-cause | NO | — | 100.0% | 100.0% | none |
| intentional-burning | YES | — | 86.7% | 96.7% | SEMANTIC_ENTAILMENT_FAILURE=4, KP_OVER_TRIGGER=1 |
| something-lit | YES | — | 96.7% | 66.7% | SEMANTIC_ENTAILMENT_FAILURE=1, KP_OVER_TRIGGER=10 |
| burning-is-coil | YES | KP3 | 83.3% | 50.0% | SEMANTIC_ENTAILMENT_FAILURE=1, KP_UNDER_TRIGGER=11, TRANSPORT_FAILURE=4 |
| smell-from-coil | YES | — | 86.7% | 33.3% | KP_OVER_TRIGGER=16, TRANSPORT_FAILURE=4 |
| mosquito-present | YES | — | 100.0% | 83.3% | KP_OVER_TRIGGER=5 |
| waking-related-to-mosquito | YES | — | 96.7% | 80.0% | KP_OVER_TRIGGER=5, TRANSPORT_FAILURE=1 |
| mosquito-woke | YES | KP1 | 90.0% | 90.0% | TRANSPORT_FAILURE=3 |
| bitten-awake | YES | KP1 | 96.7% | 93.3% | KP_UNDER_TRIGGER=1, SCHEMA_FAILURE=1 |
| hit-mosquito | YES | — | 96.7% | 60.0% | KP_OVER_TRIGGER=11, TRANSPORT_FAILURE=1 |
| slap-missed | YES | KP2 | 96.7% | 96.7% | SCHEMA_FAILURE=1 |
| killed-mosquito | NO | — | 93.3% | 96.7% | SEMANTIC_ENTAILMENT_FAILURE=1, TRANSPORT_FAILURE=1 |
| both-with-kp | BOTH | KP1 | 83.3% | 93.3% | BOTH_MIXED_PROPOSITION_FAILURE=3, SCHEMA_FAILURE=2 |
| multi-kp-2-3 | YES | KP2, KP3 | 96.7% | 93.3% | MULTI_KP_FAILURE=1, SCHEMA_FAILURE=1 |
| full-chain | YES | KP1, KP2, KP3 | 93.3% | 93.3% | SCHEMA_FAILURE=2 |
| animal-related | YES | — | 100.0% | 100.0% | none |
| revenge-related | NO | — | 93.3% | 93.3% | TRANSPORT_FAILURE=2 |
| intentional-self-hit-ambiguous | BOTH | — | 53.3% | 86.7% | BOTH_AMBIGUITY_FAILURE=10, TRANSPORT_FAILURE=4 |
| hit-self-target-ambiguous | BOTH | — | 43.3% | 83.3% | BOTH_AMBIGUITY_FAILURE=13, KP_OVER_TRIGGER=1, TRANSPORT_FAILURE=4 |
| violent-behavior-ambiguous | BOTH | — | 40.0% | 76.7% | BOTH_AMBIGUITY_FAILURE=11, TRANSPORT_FAILURE=7 |

## Regression checks

- Unknown/unimportant attributes (disability, self-hate, gender): 96.7% verdict / 100.0% KP; 56.7% verdict / 93.3% KP; 96.7% verdict / 96.7% KP.
- Relevance-direction questions (animal-related, revenge-related): 100.0% verdict / 100.0% KP; 93.3% verdict / 93.3% KP.
- Partial/contextual coverage (burning-is-coil, smell-from-coil, hit-mosquito): 83.3% verdict / 50.0% KP; 86.7% verdict / 33.3% KP; 96.7% verdict / 60.0% KP.
- Multi-key-point coverage (multi-kp-2-3, full-chain): 96.7% verdict / 93.3% KP; 93.3% verdict / 93.3% KP.
- BOTH cases (mixed-with-KP plus three ambiguity cases): 83.3% verdict / 93.3% KP; 53.3% verdict / 86.7% KP; 43.3% verdict / 83.3% KP; 40.0% verdict / 76.7% KP.

## Recommendation

- On this puzzle, GPT-5.6 Luna / medium has the strongest valid-result KP coverage accuracy among configurations with at least 90% valid results (96.0%; valid rate 100.0%).
- Do not route permanently from this single puzzle. The next experiment should use a multi-puzzle gold suite with the same independent verdict/KP metrics.
- Treat DeepSeek Pro/high as a reliability concern in this run because its invalid-result rate materially reduces usable evidence; do not infer semantic superiority from its valid rows alone.

## Interpretation

- Valid schema results with semantic misses are model/policy observations; transport, timeout, and schema failures are runtime reliability observations.
- Verdict correctness and key-point coverage are evaluated independently. A correct verdict with no KP, or a BOTH verdict with a correctly covered true proposition, is intentional.
- This single-puzzle comparison is evidence for the next experiment, not a permanent cross-game model-routing decision.

