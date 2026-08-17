export type EvidenceProgressKeyPoint = {
  id: string;
  requiredEvidenceIds: readonly string[];
};

export type EvidenceProgressJudgment = {
  messageId: string;
  playerId: string;
  sequenceNo: number;
  establishedEvidenceIds: readonly string[];
};

export type EvidenceProgressClaim = {
  keyPointId: string;
  messageId: string;
  playerId: string;
};

export type EvidenceProgressMessage = {
  messageId: string;
  playerId: string;
  discoveredKeyPointIds: string[];
  awardedPoints: number;
};

export type EvidenceProgressResult = {
  claims: EvidenceProgressClaim[];
  messages: EvidenceProgressMessage[];
  awardsByPlayer: Record<string, number>;
  discoveredCount: number;
};

function assertUnique(values: readonly string[], errorCode: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(errorCode);
    seen.add(value);
  }
}

export function rebuildEvidenceProgress(
  keyPoints: readonly EvidenceProgressKeyPoint[],
  judgments: readonly EvidenceProgressJudgment[],
): EvidenceProgressResult {
  assertUnique(keyPoints.map(({ id }) => id), 'DUPLICATE_KEY_POINT_ID');

  const requiredByKeyPoint = new Map<string, Set<string>>();
  const knownEvidenceIds = new Set<string>();
  for (const keyPoint of keyPoints) {
    assertUnique(keyPoint.requiredEvidenceIds, 'DUPLICATE_EVIDENCE_ID');
    if (keyPoint.requiredEvidenceIds.length === 0) throw new Error('EMPTY_REQUIRED_EVIDENCE');
    requiredByKeyPoint.set(keyPoint.id, new Set(keyPoint.requiredEvidenceIds));
    for (const evidenceId of keyPoint.requiredEvidenceIds) knownEvidenceIds.add(evidenceId);
  }

  const orderedJudgments = [...judgments].sort((left, right) => left.sequenceNo - right.sequenceNo);
  const seenMessages = new Set<string>();
  const establishedEvidence = new Set<string>();
  const claimedKeyPoints = new Set<string>();
  const claims: EvidenceProgressClaim[] = [];
  const messages: EvidenceProgressMessage[] = [];
  const awardsByPlayer: Record<string, number> = {};

  for (const judgment of orderedJudgments) {
    if (seenMessages.has(judgment.messageId)) throw new Error('DUPLICATE_MESSAGE_ID');
    seenMessages.add(judgment.messageId);
    assertUnique(judgment.establishedEvidenceIds, 'DUPLICATE_EVIDENCE_ID');
    for (const evidenceId of judgment.establishedEvidenceIds) {
      if (!knownEvidenceIds.has(evidenceId)) throw new Error('UNKNOWN_EVIDENCE_ID');
      establishedEvidence.add(evidenceId);
    }

    const discoveredKeyPointIds: string[] = [];
    for (const keyPoint of keyPoints) {
      if (claimedKeyPoints.has(keyPoint.id)) continue;
      const required = requiredByKeyPoint.get(keyPoint.id);
      if (!required || [...required].some((evidenceId) => !establishedEvidence.has(evidenceId))) continue;
      claimedKeyPoints.add(keyPoint.id);
      claims.push({ keyPointId: keyPoint.id, messageId: judgment.messageId, playerId: judgment.playerId });
      discoveredKeyPointIds.push(keyPoint.id);
    }

    const awardedPoints = discoveredKeyPointIds.length;
    if (awardedPoints > 0) awardsByPlayer[judgment.playerId] = (awardsByPlayer[judgment.playerId] ?? 0) + awardedPoints;
    messages.push({
      messageId: judgment.messageId,
      playerId: judgment.playerId,
      discoveredKeyPointIds,
      awardedPoints,
    });
  }

  return { claims, messages, awardsByPlayer, discoveredCount: claims.length };
}
