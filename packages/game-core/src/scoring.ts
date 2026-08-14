export type FinalAnswerOutcome = 'SUCCESS' | 'FAILED' | 'FORCE_ENDED';

export function calculateHitRate(yesCount: number, questionCount: number): number | null {
  if (questionCount === 0) {
    return null;
  }

  return yesCount / questionCount;
}

export function newClaimScore(newClaimIds: readonly string[]): number {
  return new Set(newClaimIds).size;
}

export function finalAnswerReward(outcome: FinalAnswerOutcome): number {
  return outcome === 'SUCCESS' ? 2 : 0;
}
