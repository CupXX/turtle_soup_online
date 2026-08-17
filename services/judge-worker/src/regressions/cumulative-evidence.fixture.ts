import type { EvidenceProgressJudgment, EvidenceProgressKeyPoint } from '@turtle-soup/game-core';

export const CURRENT_GAME_REGRESSION_ID = '45419d5f-9953-4d7c-a478-4963138e9c96';

export const CURRENT_GAME_EVIDENCE = {
  kp1Murder: 'e-kp1-murder',
  kp1Wife: 'e-kp1-wife',
  kp2IcePreserves: 'e-kp2-ice-preserves',
  kp2Bathtub: 'e-kp2-bathtub',
  kp3IceFailed: 'e-kp3-ice-failed',
  kp3Smell: 'e-kp3-smell',
  kp4Pressure: 'e-kp4-pressure',
  kp4SelfReport: 'e-kp4-self-report',
} as const;

export const CURRENT_GAME_REGRESSION_KEY_POINTS: EvidenceProgressKeyPoint[] = [
  { id: 'kp-1', requiredEvidenceIds: [CURRENT_GAME_EVIDENCE.kp1Murder, CURRENT_GAME_EVIDENCE.kp1Wife] },
  { id: 'kp-2', requiredEvidenceIds: [CURRENT_GAME_EVIDENCE.kp2IcePreserves, CURRENT_GAME_EVIDENCE.kp2Bathtub] },
  { id: 'kp-3', requiredEvidenceIds: [CURRENT_GAME_EVIDENCE.kp3IceFailed, CURRENT_GAME_EVIDENCE.kp3Smell] },
  { id: 'kp-4', requiredEvidenceIds: [CURRENT_GAME_EVIDENCE.kp4Pressure, CURRENT_GAME_EVIDENCE.kp4SelfReport] },
];

type HistoricalQuestion = {
  sequenceNo: number;
  content: string;
  verdict: 'YES' | 'NO' | 'BOTH' | 'IRRELEVANT';
  establishedEvidenceIds?: string[];
};

export const CURRENT_GAME_REGRESSION_QUESTIONS: HistoricalQuestion[] = [
  { sequenceNo: 1, content: '这个故事跟冰块有关吗?', verdict: 'YES' },
  { sequenceNo: 2, content: '这个故事跟杂技有关吗?', verdict: 'NO' },
  { sequenceNo: 3, content: '這個故事有其他人嗎?', verdict: 'YES' },
  { sequenceNo: 4, content: '這個男人有犯罪嗎?', verdict: 'YES' },
  { sequenceNo: 5, content: '他殺了人嗎?', verdict: 'YES', establishedEvidenceIds: [CURRENT_GAME_EVIDENCE.kp1Murder] },
  { sequenceNo: 6, content: '冰塊是用來保存死者屍體嗎?', verdict: 'YES', establishedEvidenceIds: [CURRENT_GAME_EVIDENCE.kp2IcePreserves] },
  { sequenceNo: 7, content: '死者跟他認識嗎?', verdict: 'YES' },
  { sequenceNo: 8, content: '死者是男人的家人嗎?', verdict: 'YES' },
  { sequenceNo: 9, content: '男人是誤殺死者嗎?', verdict: 'NO' },
  { sequenceNo: 10, content: '死者是男人妻子嗎?', verdict: 'YES', establishedEvidenceIds: [CURRENT_GAME_EVIDENCE.kp1Wife] },
  { sequenceNo: 11, content: '死者是出軌了嗎?', verdict: 'IRRELEVANT' },
  { sequenceNo: 12, content: '除了男人和死者故事還有其他人嗎', verdict: 'IRRELEVANT' },
  { sequenceNo: 14, content: '冰塊用完男人是發現了甚麼才決定自首嗎?', verdict: 'YES' },
  { sequenceNo: 15, content: '死者和男人發生爭執嗎?', verdict: 'IRRELEVANT' },
  { sequenceNo: 16, content: '冰塊用完後男人發現殺錯人了?', verdict: 'NO' },
  { sequenceNo: 17, content: '冰塊用來保存死者遺體嗎?', verdict: 'YES', establishedEvidenceIds: [CURRENT_GAME_EVIDENCE.kp2IcePreserves] },
  { sequenceNo: 18, content: '冰塊用完後男人發現死者遺體消失了', verdict: 'NO' },
  { sequenceNo: 19, content: '男人仇殺死者嗎?', verdict: 'NO' },
  { sequenceNo: 20, content: '男人有精神病嗎?', verdict: 'IRRELEVANT' },
  { sequenceNo: 21, content: '死者遺體完整嗎?', verdict: 'IRRELEVANT' },
  { sequenceNo: 22, content: '男人殺死死者的原因重要嗎', verdict: 'NO' },
  { sequenceNo: 23, content: '死者遺體在哪重要嗎', verdict: 'YES' },
  { sequenceNo: 24, content: '死者遺體藏在男人家裏嗎', verdict: 'YES' },
  { sequenceNo: 25, content: '藏在男人家的哪裏重要嗎?', verdict: 'YES' },
  { sequenceNo: 26, content: '死者遺體藏在他家的冰箱裏嗎?', verdict: 'NO' },
  { sequenceNo: 27, content: '死者遺體藏在他家的廚房嗎?', verdict: 'NO' },
  { sequenceNo: 28, content: '死者遺體藏在他家的倉庫裏嗎?', verdict: 'NO' },
  { sequenceNo: 29, content: '死者遺體藏在他家的臥室裏嗎?', verdict: 'NO' },
  { sequenceNo: 30, content: '死者遺體藏在他家的陽台裏嗎?', verdict: 'NO' },
  { sequenceNo: 31, content: '死者遺體藏在他家的魚缸嗎?', verdict: 'NO' },
  { sequenceNo: 32, content: '死者遺體藏在他家的浴室裏嗎?', verdict: 'YES' },
  { sequenceNo: 33, content: '他發現了冰塊融化的屍水全流出去下水道了', verdict: 'NO' },
  { sequenceNo: 34, content: '屍體藏在浴室哪裏重要嗎', verdict: 'YES' },
  { sequenceNo: 35, content: '屍體藏在浴缸嗎', verdict: 'YES', establishedEvidenceIds: [CURRENT_GAME_EVIDENCE.kp2Bathtub] },
  { sequenceNo: 36, content: '冰塊用完他發現的是屍體的變化嗎?', verdict: 'YES' },
  { sequenceNo: 37, content: '他發現了他老婆是自殺?', verdict: 'NO' },
  { sequenceNo: 38, content: '他發現了冰塊對保存屍體失去效果了', verdict: 'YES', establishedEvidenceIds: [CURRENT_GAME_EVIDENCE.kp3IceFailed] },
  { sequenceNo: 39, content: '他是戀屍癖嗎', verdict: 'NO' },
  { sequenceNo: 40, content: '他保存死者屍體在家裏是怕被別人發現他殺了人嗎?', verdict: 'YES' },
  { sequenceNo: 41, content: '他知道屍體保存不了會發出屍臭,早晚被人發現,決定自首', verdict: 'YES', establishedEvidenceIds: [CURRENT_GAME_EVIDENCE.kp3Smell, CURRENT_GAME_EVIDENCE.kp4SelfReport] },
  { sequenceNo: 42, content: '他殺死妻子的方法重要嗎', verdict: 'NO' },
];

export function regressionJudgments(): EvidenceProgressJudgment[] {
  return CURRENT_GAME_REGRESSION_QUESTIONS.map((question, index) => ({
    messageId: `message-${question.sequenceNo}`,
    playerId: index < 4 ? 'player-a' : 'player-b',
    sequenceNo: question.sequenceNo,
    establishedEvidenceIds: question.establishedEvidenceIds ?? [],
  }));
}
