# 蚊子汤模型控制实验报告

生成时间：2026-08-15T06:11:31.929Z

## A. 最终提取的关键点

1. 他半夜醒来是因为被蚊子叮咬
2. 他打自己一巴掌是为了打蚊子，但没有打到
3. 燃烧的味道来自他后来点燃的蚊香

## B. Question Judge 逐题比较

| Case | Question | Expected verdict | Expected coverage | Configuration | Actual verdict | Actual coverage | Verdict correct | Coverage correct | Schema valid | Latency | Tokens (input / output) | Cost (USD) | Error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dead | 这个人死了吗？ | NO | — | Flash | NO | — | ✅ | ✅ | ✅ | 3339 ms | N/A / N/A | N/A | N/A |
| second-person | 故事里还有第二个人吗？ | NO | — | Flash | NO | — | ✅ | ✅ | ✅ | 3162 ms | N/A / N/A | N/A | N/A |
| mosquito-present | 是不是有蚊子？ | YES | — | Flash | YES | — | ✅ | ✅ | ✅ | 3219 ms | N/A / N/A | N/A | N/A |
| hit-mosquito | 是不是打蚊子？ | YES | — | Flash | YES | — | ✅ | ✅ | ✅ | 3178 ms | N/A / N/A | N/A | N/A |
| lit-coil | 是不是点了蚊香？ | YES | KP3 | Flash | YES | KP3 | ✅ | ✅ | ✅ | 3384 ms | N/A / N/A | N/A | N/A |
| mosquito-woke | 是不是蚊子把他弄醒的？ | YES | KP1 | Flash | YES | — | ✅ | ❌ | ✅ | 3237 ms | N/A / N/A | N/A | N/A |
| slap-missed | 他这一巴掌是在打蚊子，但是没打中吗？ | YES | KP2 | Flash | YES | KP2 | ✅ | ✅ | ✅ | 3103 ms | N/A / N/A | N/A | N/A |
| both-with-kp | 他是被蚊子叮醒的，而且后来把蚊子打死了，对吗？ | BOTH | KP1 | Flash | BOTH | KP1 | ✅ | ✅ | ✅ | 3443 ms | N/A / N/A | N/A | N/A |
| dead | 这个人死了吗？ | NO | — | Pro | NO | — | ✅ | ✅ | ✅ | 3905 ms | N/A / N/A | N/A | N/A |
| second-person | 故事里还有第二个人吗？ | NO | — | Pro | NO | — | ✅ | ✅ | ✅ | 3447 ms | N/A / N/A | N/A | N/A |
| mosquito-present | 是不是有蚊子？ | YES | — | Pro | YES | — | ✅ | ✅ | ✅ | 3456 ms | N/A / N/A | N/A | N/A |
| hit-mosquito | 是不是打蚊子？ | YES | — | Pro | YES | — | ✅ | ✅ | ✅ | 3615 ms | N/A / N/A | N/A | N/A |
| lit-coil | 是不是点了蚊香？ | YES | KP3 | Pro | YES | — | ✅ | ❌ | ✅ | 3199 ms | N/A / N/A | N/A | N/A |
| mosquito-woke | 是不是蚊子把他弄醒的？ | YES | KP1 | Pro | YES | KP1 | ✅ | ✅ | ✅ | 3586 ms | N/A / N/A | N/A | N/A |
| slap-missed | 他这一巴掌是在打蚊子，但是没打中吗？ | YES | KP2 | Pro | BOTH | — | ❌ | ❌ | ✅ | 3749 ms | N/A / N/A | N/A | N/A |
| both-with-kp | 他是被蚊子叮醒的，而且后来把蚊子打死了，对吗？ | BOTH | KP1 | Pro | BOTH | — | ✅ | ❌ | ✅ | 3647 ms | N/A / N/A | N/A | N/A |
| dead | 这个人死了吗？ | NO | — | Pro + thinking | N/A | — | ❌ | ❌ | ❌ | 5650 ms | N/A / N/A | N/A | TRANSPORT_ERROR |
| second-person | 故事里还有第二个人吗？ | NO | — | Pro + thinking | NO | — | ✅ | ✅ | ✅ | 4956 ms | N/A / N/A | N/A | N/A |
| mosquito-present | 是不是有蚊子？ | YES | — | Pro + thinking | YES | — | ✅ | ✅ | ✅ | 5747 ms | N/A / N/A | N/A | N/A |
| hit-mosquito | 是不是打蚊子？ | YES | — | Pro + thinking | YES | — | ✅ | ✅ | ✅ | 5668 ms | N/A / N/A | N/A | N/A |
| lit-coil | 是不是点了蚊香？ | YES | KP3 | Pro + thinking | N/A | — | ❌ | ❌ | ❌ | 4645 ms | N/A / N/A | N/A | TRANSPORT_ERROR |
| mosquito-woke | 是不是蚊子把他弄醒的？ | YES | KP1 | Pro + thinking | YES | KP1 | ✅ | ✅ | ✅ | 18573 ms | N/A / N/A | N/A | N/A |
| slap-missed | 他这一巴掌是在打蚊子，但是没打中吗？ | YES | KP2 | Pro + thinking | YES | KP2 | ✅ | ✅ | ✅ | 5530 ms | N/A / N/A | N/A | N/A |
| both-with-kp | 他是被蚊子叮醒的，而且后来把蚊子打死了，对吗？ | BOTH | KP1 | Pro + thinking | N/A | — | ❌ | ❌ | ❌ | 6772 ms | N/A / N/A | N/A | INVALID_JSON |

## C. 准确率摘要

| Configuration | Verdict accuracy | KP coverage accuracy | Schema validity | Average latency |
| --- | --- | --- | --- | --- |
| Flash | 8/8 | 7/8 | 8/8 | 3258 ms |
| Pro | 7/8 | 5/8 | 8/8 | 3576 ms |
| Pro + thinking | 5/8 | 5/8 | 5/8 | 7193 ms |

Verdict accuracy and key-point coverage accuracy are intentionally reported separately. A YES/NO/BOTH/IRRELEVANT verdict does not by itself imply that any key point was fully covered.

## D. 延迟与用量

Latency is measured end to end for each model call. The current headless Harness stdout contract does not expose provider token usage or cost, so those fields are reported as N/A rather than estimated.

## E. Interpretation

The controlled fixture uses one production prompt, one fixed key-point set, and identical eight semantic inputs for all configurations. If the same case fails across all three configurations, treat it as a remaining prompt/policy problem first. Differences isolated to one model or reasoning setting are evidence of capability/configuration sensitivity, not proof that the original failure was model incapability.

## F. Next experiment recommendation

Keep the current v2 semantic policy and repeat this fixture after any prompt change. If verdict accuracy is stable but coverage differs, tune only the complete-fact coverage policy. If the three configurations remain separated after a second run, use Pro + thinking for extraction and compare Flash versus Pro for question judging on a larger fixed suite before selecting a permanent production route.
