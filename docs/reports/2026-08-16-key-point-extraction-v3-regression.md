# Key Point Extraction v3 regression

- Generated: 2026-08-15T16:31:14.666Z
- Prompt: key-point-extraction-v3
- Configuration: GPT-5.6 Luna / medium
- Attempts: 10

## Approved semantic targets

### mosquito

- Surface: 一个人半夜醒来打了自己一巴掌，然后闻着一股燃烧的味道安心睡去了，请问发生了什么？
- Solution: 这个人被蚊子叮醒，打了一下没打着，然后点起了蚊香。
- Expected semantic units:
  1. 他是被蚊子叮醒的。
  2. 那一巴掌是为了打蚊子，而且没有打中。
  3. 他随后点燃了蚊香。

### all-choices-correct

- Surface: 有一道选择题，不论选什么都是对的
- Solution: 凶手将尸块藏在了不同的房间里，对被害人的妈妈说，猜猜你的孩子在哪间屋子。母亲不论做出任何选择，凶手都说，回答正确。母亲因此得知自己的孩子已经被彻底杀害，残忍分尸。
- Expected semantic units:
  1. 所谓选择题是凶手让被害人的母亲猜孩子在哪个房间。
  2. 被害人的尸体已经被分尸。
  3. 尸块分散在多个候选房间，因此选哪个房间都能被说成正确。

## Raw extraction outputs

| Round | Puzzle | Schema | Points | Latency ms | Input tokens | Output tokens | Error |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | mosquito | valid | 3 | 3087 | N/A | N/A | — |
|  | mosquito output |  |  |  |  |  | 他是被蚊子叮咬而惊醒的。 / 他打自己那一巴掌是为了打蚊子，但没有打中。 / 他点燃了蚊香，燃烧的气味让他确认蚊子正在被驱赶。 |
| 1 | all-choices-correct | valid | 3 | 5623 | N/A | N/A | — |
|  | all-choices-correct output |  |  |  |  |  | 凶手先将受害人彻底杀害并分尸。 / 凶手把受害人的尸块分别藏在不同的房间里。 / 凶手将“孩子在哪间屋子”解释为“哪间屋子里有孩子的尸块”，因此每个房间选项都能被判定为正确。 |
| 2 | mosquito | valid | 3 | 5695 | N/A | N/A | — |
|  | mosquito output |  |  |  |  |  | 他是被蚊子叮咬而从睡梦中弄醒的。 / 他挥掌是为了打蚊子，但没有打中。 / 他随后点燃了蚊香来驱蚊。 |
| 2 | all-choices-correct | valid | 3 | 4327 | N/A | N/A | — |
|  | all-choices-correct output |  |  |  |  |  | 凶手先将被害人分尸成多个尸块。 / 凶手把这些尸块分别藏在不同的房间里。 / “孩子在哪间屋子”的提问指向尸块所在位置，因此每个房间都能使母亲的选择被判定为正确。 |
| 3 | mosquito | valid | 3 | 3564 | N/A | N/A | — |
|  | mosquito output |  |  |  |  |  | 他是被蚊子叮咬而惊醒的。 / 他打自己一巴掌是为了打蚊子，但没有打中。 / 他随后点燃了蚊香，闻到的燃烧味来自蚊香。 |
| 3 | all-choices-correct | valid | 3 | 3568 | N/A | N/A | — |
|  | all-choices-correct output |  |  |  |  |  | 凶手把被害人的尸块分别藏在不同的房间里。 / 凶手让被害人的母亲猜孩子在哪一间屋子。 / 由于每个选项对应的房间都藏有孩子的尸块，凶手才会对母亲的任何选择都判定为正确。 |
| 4 | mosquito | valid | 3 | 3736 | N/A | N/A | — |
|  | mosquito output |  |  |  |  |  | 他是被蚊子叮咬而醒来的。 / 他打自己那一巴掌其实是为了拍打蚊子，但没有打中。 / 燃烧的气味来自他点燃的蚊香，用来驱赶蚊子。 |
| 4 | all-choices-correct | valid | 3 | 5551 | N/A | N/A | — |
|  | all-choices-correct output |  |  |  |  |  | 凶手把被害人的尸块分别藏在不同的房间里。 / 凶手让被害人的母亲猜测孩子在哪一间屋子。 / 由于每个被选房间里都藏有被害人的一块尸块，凶手无论母亲选择哪间屋子都能说她答对了。 |
| 5 | mosquito | valid | 3 | 3328 | N/A | N/A | — |
|  | mosquito output |  |  |  |  |  | 蚊子叮咬使这个人醒来。 / 他挥掌是为了打蚊子，但没有打中。 / 他点燃了蚊香，闻到的燃烧味来自蚊香。 |
| 5 | all-choices-correct | valid | 3 | 4366 | N/A | N/A | — |
|  | all-choices-correct output |  |  |  |  |  | 被害人已经被凶手分尸，尸体变成了多个尸块。 / 凶手把这些尸块分别藏在了不同的房间里。 / 因为每个房间都藏有被害人的尸块，所以母亲无论指向哪间屋子，凶手都能把她的选择说成正确。 |

## Review rule

- The runner validates only schema, 3–5 count, non-empty content, and duplicate rejection. Semantic paraphrases must be reviewed against the approved independent-discovery targets above; this report does not use brittle keyword matching.
