# Mosquito Question Judge v4 — 25-case, 3-configuration, 5-round comparison

- Generated: 2026-08-15T12:59:53.076Z
- Fixture: services/judge-worker/benchmarks/fixtures/mosquito-question-judge-v4-25cases.json
- Prompt: question-judge-v4
- Schema: judge-schema-v1
- Rounds: 5
- Attempts: 375
- Frozen commit: not recorded

## Fixed key points

- KP1: 他半夜醒来是因为被蚊子叮醒。
- KP2: 他打自己一巴掌是为了拍蚊子，但没有打着。
- KP3: 他随后点燃了蚊香。

## Configuration comparison

| Configuration | Attempts | Valid | Verdict accuracy | Valid verdict accuracy | KP coverage accuracy | Valid KP coverage accuracy | Avg ms | P50 ms | P95 ms | Input tokens | Output tokens | Failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| GPT-5.6 Luna / none | 125 | 125 | 88.0% | 88.0% | 82.4% | 82.4% | 1237.4 | 1146.0 | 2116.0 | 184255 | 4183 | UNKNOWN_VS_FALSE_FAILURE=1, BOTH_AMBIGUITY_FAILURE=14, KP_OVER_TRIGGER=21, KP_UNDER_TRIGGER=1 |
| GPT-5.6 Luna / medium | 125 | 125 | 88.0% | 88.0% | 97.6% | 97.6% | 2309.3 | 2092.0 | 3757.0 | 184255 | 17719 | UNKNOWN_VS_FALSE_FAILURE=4, SEMANTIC_ENTAILMENT_FAILURE=1, BOTH_AMBIGUITY_FAILURE=10, KP_UNDER_TRIGGER=3 |
| DeepSeek Pro / off | 125 | 125 | 82.4% | 82.4% | 92.0% | 92.0% | 3791.0 | 3489.0 | 4826.0 | N/A | N/A | UNKNOWN_VS_FALSE_FAILURE=5, SEMANTIC_ENTAILMENT_FAILURE=2, BOTH_AMBIGUITY_FAILURE=15, KP_OVER_TRIGGER=9, KP_UNDER_TRIGGER=1 |

## Overall

- Verdict accuracy: 86.1% (323/375)
- Key-point coverage accuracy: 90.7% (340/375)
- Valid result rate: 100.0%
- Latency: average 2445.9 ms, P50 2137.0 ms, P95 4173.0 ms
- Token/cost fields are authoritative provider values only; absent values remain N/A.

## Case stability and failure categories

| Case | Expected verdict | Expected KP | Verdict accuracy | KP coverage accuracy | Failures |
| --- | --- | --- | ---: | ---: | --- |
| dead | NO | — | 86.7% | 100.0% | SEMANTIC_ENTAILMENT_FAILURE=2 |
| second-person | NO | — | 100.0% | 100.0% | none |
| disability | IRRELEVANT | — | 100.0% | 100.0% | none |
| self-hate | IRRELEVANT | — | 33.3% | 100.0% | UNKNOWN_VS_FALSE_FAILURE=10 |
| gender | IRRELEVANT | — | 100.0% | 100.0% | none |
| self-hate-cause | NO | — | 100.0% | 100.0% | none |
| intentional-burning | YES | — | 100.0% | 100.0% | none |
| something-lit | YES | — | 93.3% | 46.7% | SEMANTIC_ENTAILMENT_FAILURE=1, KP_OVER_TRIGGER=8 |
| burning-is-coil | YES | KP3 | 100.0% | 66.7% | KP_UNDER_TRIGGER=5 |
| smell-from-coil | YES | — | 100.0% | 53.3% | KP_OVER_TRIGGER=7 |
| mosquito-present | YES | — | 100.0% | 73.3% | KP_OVER_TRIGGER=4 |
| waking-related-to-mosquito | YES | — | 100.0% | 80.0% | KP_OVER_TRIGGER=3 |
| mosquito-woke | YES | KP1 | 100.0% | 100.0% | none |
| bitten-awake | YES | KP1 | 100.0% | 100.0% | none |
| hit-mosquito | YES | — | 100.0% | 60.0% | KP_OVER_TRIGGER=6 |
| slap-missed | YES | KP2 | 100.0% | 100.0% | none |
| killed-mosquito | NO | — | 100.0% | 100.0% | none |
| both-with-kp | BOTH | KP1 | 100.0% | 100.0% | none |
| multi-kp-2-3 | YES | KP2, KP3 | 100.0% | 100.0% | none |
| full-chain | YES | KP1, KP2, KP3 | 100.0% | 100.0% | none |
| animal-related | YES | — | 100.0% | 100.0% | none |
| revenge-related | NO | — | 100.0% | 100.0% | none |
| intentional-self-hit-ambiguous | BOTH | — | 33.3% | 100.0% | BOTH_AMBIGUITY_FAILURE=10 |
| hit-self-target-ambiguous | BOTH | — | 6.7% | 86.7% | BOTH_AMBIGUITY_FAILURE=14, KP_OVER_TRIGGER=2 |
| violent-behavior-ambiguous | BOTH | — | 0.0% | 100.0% | BOTH_AMBIGUITY_FAILURE=15 |

## Regression checks

- Unknown/unimportant attributes (disability, self-hate, gender): 100.0% verdict / 100.0% KP; 33.3% verdict / 100.0% KP; 100.0% verdict / 100.0% KP.
- Relevance-direction questions (animal-related, revenge-related): 100.0% verdict / 100.0% KP; 100.0% verdict / 100.0% KP.
- Partial/contextual coverage (burning-is-coil, smell-from-coil, hit-mosquito): 100.0% verdict / 66.7% KP; 100.0% verdict / 53.3% KP; 100.0% verdict / 60.0% KP.
- Multi-key-point coverage (multi-kp-2-3, full-chain): 100.0% verdict / 100.0% KP; 100.0% verdict / 100.0% KP.
- BOTH cases (mixed-with-KP plus three ambiguity cases): 100.0% verdict / 100.0% KP; 33.3% verdict / 100.0% KP; 6.7% verdict / 86.7% KP; 0.0% verdict / 100.0% KP.

## Recommendation

- On this puzzle, GPT-5.6 Luna / medium has the strongest valid-result KP coverage accuracy among configurations with at least 90% valid results (97.6%; valid rate 100.0%).
- Do not route permanently from this single puzzle. The next experiment should use a multi-puzzle gold suite with the same independent verdict/KP metrics.
- Treat configuration-specific transport and schema failures as reliability observations; do not infer semantic superiority from valid rows alone.

## Interpretation

- Valid schema results with semantic misses are model/policy observations; transport, timeout, and schema failures are runtime reliability observations.
- Verdict correctness and key-point coverage are evaluated independently. A correct verdict with no KP, or a BOTH verdict with a correctly covered true proposition, is intentional.
- This single-puzzle comparison is evidence for the next experiment, not a permanent cross-game model-routing decision.
