import type { JudgeVerdict } from '@turtle-soup/contracts';

export type VerdictReaction = '✅' | '❌' | '❓' | '👎';

const REACTIONS: Record<JudgeVerdict, VerdictReaction> = {
  YES: '✅',
  NO: '❌',
  BOTH: '❓',
  IRRELEVANT: '👎',
};

export function reactionForVerdict(verdict: JudgeVerdict): VerdictReaction {
  return REACTIONS[verdict];
}
