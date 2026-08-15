# 蚊子汤模型控制实验报告

生成时间：2026-08-15T07:06:58.644Z

## A. 最终提取的关键点

1. 他半夜醒来是因为被蚊子叮咬。
2. 他打自己一巴掌是为了拍蚊子，但没有打着。
3. 他随后点燃了蚊香，燃烧的气味来自蚊香。

## B. Question Judge 逐题比较

| Case | Question | Expected verdict | Expected coverage | Configuration | Actual verdict | Actual coverage | Verdict correct | Coverage correct | Schema valid | Latency | Tokens (input / output) | Cost (USD) | Error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dead | 这个人死了吗？ | NO | — | Flash | NO | — | ✅ | ✅ | ✅ | 3871 ms | N/A / N/A | N/A | N/A |
| second-person | 故事里还有第二个人吗？ | NO | — | Flash | NO | — | ✅ | ✅ | ✅ | 3371 ms | N/A / N/A | N/A | N/A |
| mosquito-present | 是不是有蚊子？ | YES | — | Flash | YES | — | ✅ | ✅ | ✅ | 4058 ms | N/A / N/A | N/A | N/A |
| hit-mosquito | 是不是打蚊子？ | YES | — | Flash | YES | — | ✅ | ✅ | ✅ | 3709 ms | N/A / N/A | N/A | N/A |
| lit-coil | 是不是点了蚊香？ | YES | KP3 | Flash | YES | KP3 | ✅ | ✅ | ✅ | 3808 ms | N/A / N/A | N/A | N/A |
| mosquito-woke | 是不是蚊子把他弄醒的？ | YES | KP1 | Flash | YES | KP1 | ✅ | ✅ | ✅ | 3748 ms | N/A / N/A | N/A | N/A |
| slap-missed | 他这一巴掌是在打蚊子，但是没打中吗？ | YES | KP2 | Flash | YES | KP2 | ✅ | ✅ | ✅ | 3799 ms | N/A / N/A | N/A | N/A |
| both-with-kp | 他是被蚊子叮醒的，而且后来把蚊子打死了，对吗？ | BOTH | KP1 | Flash | BOTH | KP1 | ✅ | ✅ | ✅ | 3679 ms | N/A / N/A | N/A | N/A |
| dead | 这个人死了吗？ | NO | — | Pro | NO | — | ✅ | ✅ | ✅ | 4364 ms | N/A / N/A | N/A | N/A |
| second-person | 故事里还有第二个人吗？ | NO | — | Pro | NO | — | ✅ | ✅ | ✅ | 4065 ms | N/A / N/A | N/A | N/A |
| mosquito-present | 是不是有蚊子？ | YES | — | Pro | YES | — | ✅ | ✅ | ✅ | 4080 ms | N/A / N/A | N/A | N/A |
| hit-mosquito | 是不是打蚊子？ | YES | — | Pro | YES | — | ✅ | ✅ | ✅ | 4037 ms | N/A / N/A | N/A | N/A |
| lit-coil | 是不是点了蚊香？ | YES | KP3 | Pro | YES | — | ✅ | ❌ | ✅ | 3971 ms | N/A / N/A | N/A | N/A |
| mosquito-woke | 是不是蚊子把他弄醒的？ | YES | KP1 | Pro | YES | KP1 | ✅ | ✅ | ✅ | 4260 ms | N/A / N/A | N/A | N/A |
| slap-missed | 他这一巴掌是在打蚊子，但是没打中吗？ | YES | KP2 | Pro | YES | KP2 | ✅ | ✅ | ✅ | 4068 ms | N/A / N/A | N/A | N/A |
| both-with-kp | 他是被蚊子叮醒的，而且后来把蚊子打死了，对吗？ | BOTH | KP1 | Pro | BOTH | KP1 | ✅ | ✅ | ✅ | 4180 ms | N/A / N/A | N/A | N/A |
| dead | 这个人死了吗？ | NO | — | Pro + thinking | NO | — | ✅ | ✅ | ✅ | 5852 ms | N/A / N/A | N/A | N/A |
| second-person | 故事里还有第二个人吗？ | NO | — | Pro + thinking | N/A | — | ❌ | ❌ | ❌ | 5958 ms | N/A / N/A | N/A | TRANSPORT_ERROR |
| mosquito-present | 是不是有蚊子？ | YES | — | Pro + thinking | YES | — | ✅ | ✅ | ✅ | 5615 ms | N/A / N/A | N/A | N/A |
| hit-mosquito | 是不是打蚊子？ | YES | — | Pro + thinking | YES | — | ✅ | ✅ | ✅ | 6945 ms | N/A / N/A | N/A | N/A |
| lit-coil | 是不是点了蚊香？ | YES | KP3 | Pro + thinking | YES | — | ✅ | ❌ | ✅ | 5890 ms | N/A / N/A | N/A | N/A |
| mosquito-woke | 是不是蚊子把他弄醒的？ | YES | KP1 | Pro + thinking | YES | KP1 | ✅ | ✅ | ✅ | 7673 ms | N/A / N/A | N/A | N/A |
| slap-missed | 他这一巴掌是在打蚊子，但是没打中吗？ | YES | KP2 | Pro + thinking | YES | KP2 | ✅ | ✅ | ✅ | 6990 ms | N/A / N/A | N/A | N/A |
| both-with-kp | 他是被蚊子叮醒的，而且后来把蚊子打死了，对吗？ | BOTH | KP1 | Pro + thinking | BOTH | KP1 | ✅ | ✅ | ✅ | 7705 ms | N/A / N/A | N/A | N/A |

## C. 准确率摘要

| Configuration | Verdict accuracy | KP coverage accuracy | Schema validity | Average latency |
| --- | --- | --- | --- | --- |
| Flash | 8/8 | 8/8 | 8/8 | 3755 ms |
| Pro | 8/8 | 7/8 | 8/8 | 4128 ms |
| Pro + thinking | 7/8 | 6/8 | 7/8 | 6579 ms |

Verdict accuracy and key-point coverage accuracy are intentionally reported separately. A YES/NO/BOTH/IRRELEVANT verdict does not by itself imply that any key point was fully covered.

## D. 延迟与用量

Latency is measured end to end for each model call. The current headless Harness stdout contract does not expose provider token usage or cost, so those fields are reported as N/A rather than estimated.

## E. Interpretation

The controlled fixture uses one production prompt, one fixed key-point set, and identical eight semantic inputs for all configurations. If the same case fails across all three configurations, treat it as a remaining prompt/policy problem first. Differences isolated to one model or reasoning setting are evidence of capability/configuration sensitivity, not proof that the original failure was model incapability.

## F. Next experiment recommendation

Keep the current v2 semantic policy and repeat this fixture after any prompt change. If verdict accuracy is stable but coverage differs, tune only the complete-fact coverage policy. If the three configurations remain separated after a second run, use Pro + thinking for extraction and compare Flash versus Pro for question judging on a larger fixed suite before selecting a permanent production route.
