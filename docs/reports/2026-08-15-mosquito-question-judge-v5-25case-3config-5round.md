# Mosquito Question Judge v5 — 25-case, 3-configuration, 5-round comparison

- Generated: 2026-08-15T14:14:02.105Z
- Fixture: services/judge-worker/benchmarks/fixtures/mosquito-question-judge-v5-25cases.json
- Prompt: question-judge-v5
- Schema: judge-schema-v1
- Rounds: 5
- Attempts: 375
- Frozen commit: fb7b177ec49d932d0c3f1f566e5083d632fa001b

## Fixed key points

- KP1: 他半夜醒来是因为被蚊子叮醒。
- KP2: 他打自己一巴掌是为了拍蚊子，但没有打着。
- KP3: 他随后点燃了蚊香。

## Configuration comparison

| Configuration | Attempts | Valid | Verdict accuracy | KP coverage accuracy | Strict joint accuracy | Valid verdict accuracy | Valid KP coverage accuracy | Avg ms | P50 ms | P95 ms | Input tokens | Output tokens | Failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| GPT-5.6 Luna / none | 125 | 125 | 90.4% | 88.8% | 79.2% | 90.4% | 88.8% | 1358.6 | 1259.0 | 2028.0 | 209505 | 4083 | SEMANTIC_ENTAILMENT_FAILURE=7, BOTH_AMBIGUITY_FAILURE=5, KP_OVER_TRIGGER=14 |
| GPT-5.6 Luna / medium | 125 | 125 | 97.6% | 99.2% | 96.8% | 97.6% | 99.2% | 2038.7 | 1780.0 | 3775.0 | 209505 | 15543 | SEMANTIC_ENTAILMENT_FAILURE=3, KP_UNDER_TRIGGER=1 |
| DeepSeek Pro / off | 125 | 124 | 84.0% | 92.0% | 77.6% | 84.7% | 92.7% | 3742.7 | 3678.0 | 4414.0 | N/A | N/A | SEMANTIC_ENTAILMENT_FAILURE=11, BOTH_MIXED_PROPOSITION_FAILURE=2, BOTH_AMBIGUITY_FAILURE=5, BOTH_OVER_TRIGGER=1, KP_OVER_TRIGGER=9, TRANSPORT_FAILURE=1 |

## Overall

- Verdict accuracy: 90.7% (340/375)
- Key-point coverage accuracy: 93.3% (350/375)
- Strict joint accuracy: 84.5% (317/375)
- Valid result rate: 99.7%
- Latency: average 2380.0 ms, P50 1892.0 ms, P95 4208.0 ms
- Token/cost fields are authoritative provider values only; absent values remain N/A.

## Actual verdict distribution

| Configuration | YES | NO | BOTH | IRRELEVANT | Invalid |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPT-5.6 Luna / none | 76 | 27 | 5 | 17 | 0 |
| GPT-5.6 Luna / medium | 75 | 27 | 10 | 13 | 0 |
| DeepSeek Pro / off | 74 | 32 | 4 | 14 | 1 |

## Case stability and failure categories

| Case | Expected verdict | Expected KP | Verdict accuracy | KP coverage accuracy | Failures |
| --- | --- | --- | ---: | ---: | --- |
| dead | NO | — | 66.7% | 100.0% | SEMANTIC_ENTAILMENT_FAILURE=5 |
| second-person | NO | — | 93.3% | 100.0% | SEMANTIC_ENTAILMENT_FAILURE=1 |
| disability | IRRELEVANT | — | 100.0% | 100.0% | none |
| self-hate | NO | — | 46.7% | 100.0% | SEMANTIC_ENTAILMENT_FAILURE=8 |
| gender | IRRELEVANT | — | 100.0% | 100.0% | none |
| self-hate-cause | NO | — | 100.0% | 100.0% | none |
| intentional-burning | YES | — | 66.7% | 100.0% | SEMANTIC_ENTAILMENT_FAILURE=5 |
| something-lit | YES | — | 100.0% | 66.7% | KP_OVER_TRIGGER=5 |
| burning-is-coil | YES | KP3 | 100.0% | 93.3% | KP_UNDER_TRIGGER=1 |
| smell-from-coil | YES | — | 100.0% | 80.0% | KP_OVER_TRIGGER=3 |
| mosquito-present | YES | — | 100.0% | 86.7% | KP_OVER_TRIGGER=2 |
| waking-related-to-mosquito | YES | — | 100.0% | 73.3% | KP_OVER_TRIGGER=4 |
| mosquito-woke | YES | KP1 | 100.0% | 100.0% | none |
| bitten-awake | YES | KP1 | 93.3% | 93.3% | TRANSPORT_FAILURE=1 |
| hit-mosquito | YES | — | 100.0% | 46.7% | KP_OVER_TRIGGER=8 |
| slap-missed | YES | KP2 | 100.0% | 100.0% | none |
| killed-mosquito | NO | — | 86.7% | 93.3% | SEMANTIC_ENTAILMENT_FAILURE=2, KP_OVER_TRIGGER=1 |
| both-with-kp | BOTH | KP1 | 86.7% | 100.0% | BOTH_MIXED_PROPOSITION_FAILURE=2 |
| multi-kp-2-3 | YES | KP2, KP3 | 100.0% | 100.0% | none |
| full-chain | YES | KP1, KP2, KP3 | 100.0% | 100.0% | none |
| animal-related | YES | — | 100.0% | 100.0% | none |
| revenge-related | NO | — | 100.0% | 100.0% | none |
| intentional-self-hit-ambiguous | BOTH | — | 33.3% | 100.0% | BOTH_AMBIGUITY_FAILURE=10 |
| hit-self-target-ambiguous | YES | — | 93.3% | 100.0% | BOTH_OVER_TRIGGER=1 |
| violent-behavior-ambiguous | YES | — | 100.0% | 100.0% | none |

## Regression checks

- Unknown/unimportant attributes (disability, self-hate, gender): 100.0% verdict / 100.0% KP; 46.7% verdict / 100.0% KP; 100.0% verdict / 100.0% KP.
- Relevance-direction questions (animal-related, revenge-related): 100.0% verdict / 100.0% KP; 100.0% verdict / 100.0% KP.
- Partial/contextual coverage (burning-is-coil, smell-from-coil, hit-mosquito): 100.0% verdict / 93.3% KP; 100.0% verdict / 80.0% KP; 100.0% verdict / 46.7% KP.
- Multi-key-point coverage (multi-kp-2-3, full-chain): 100.0% verdict / 100.0% KP; 100.0% verdict / 100.0% KP.
- BOTH cases (mixed-with-KP plus three ambiguity cases): 86.7% verdict / 100.0% KP; 33.3% verdict / 100.0% KP; 93.3% verdict / 100.0% KP; 100.0% verdict / 100.0% KP.

## Recommendation

- On this puzzle, GPT-5.6 Luna / medium has the strongest valid-result KP coverage accuracy among configurations with at least 90% valid results (99.2%; valid rate 100.0%).
- Do not route permanently from this single puzzle. The next experiment should use a multi-puzzle gold suite with the same independent verdict/KP metrics.
- Treat configuration-specific transport and schema failures as reliability observations; do not infer semantic superiority from valid rows alone.

## Interpretation

- Valid schema results with semantic misses are model/policy observations; transport, timeout, and schema failures are runtime reliability observations.
- Verdict correctness and key-point coverage are evaluated independently. A correct verdict with no KP, or a BOTH verdict with a correctly covered true proposition, is intentional.
- This single-puzzle comparison is evidence for the next experiment, not a permanent cross-game model-routing decision.

## v4 → v5 focused comparison

| Case | v4 gold | v5 gold | v4 verdict / KP / strict | v5 verdict / KP / strict |
| --- | --- | --- | --- | --- |
| self-hate | IRRELEVANT / — | NO / — | 33.3% / 100.0% / 33.3% | 46.7% / 100.0% / 46.7% |
| intentional-self-hit-ambiguous | BOTH / — | BOTH / — | 33.3% / 100.0% / 33.3% | 33.3% / 100.0% / 33.3% |
| hit-self-target-ambiguous | BOTH / — | YES / — | 6.7% / 86.7% / 6.7% | 93.3% / 100.0% / 93.3% |
| violent-behavior-ambiguous | BOTH / — | YES / — | 0.0% / 100.0% / 0.0% | 100.0% / 100.0% / 100.0% |
| burning-is-coil | YES / KP3 | YES / KP3 | 100.0% / 66.7% / 66.7% | 100.0% / 93.3% / 93.3% |

- Previously 100%-stable non-focus cases: 14 checked; 5 regressed.
- Regressed case IDs: second-person, intentional-burning, bitten-awake, killed-mosquito, both-with-kp.
