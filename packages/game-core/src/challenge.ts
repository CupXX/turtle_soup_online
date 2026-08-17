import type { JudgeVerdict } from '@turtle-soup/contracts';

const VERDICTS: readonly JudgeVerdict[] = ['YES', 'NO', 'BOTH', 'IRRELEVANT'];

export type ChallengeVote = {
  valid: boolean;
  verdict?: JudgeVerdict;
  coveredKeyPointIds?: readonly string[];
  establishedEvidenceIds?: readonly string[];
};

export type ChallengeResolution = {
  verdict: JudgeVerdict;
  coveredKeyPointIds: string[];
};

export type EvidenceChallengeVote = {
  valid: boolean;
  verdict?: JudgeVerdict;
  establishedEvidenceIds?: readonly string[];
};

export type EvidenceChallengeResolution = {
  verdict: JudgeVerdict;
  establishedEvidenceIds: string[];
};

function assertUniqueKnownIds(ids: readonly string[], knownIds: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error('DUPLICATE_KEY_POINT_ID');
    if (!knownIds.has(id)) throw new Error('UNKNOWN_KEY_POINT_ID');
    seen.add(id);
  }
}

function assertUniqueKnownEvidenceIds(ids: readonly string[], knownIds: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error('DUPLICATE_EVIDENCE_ID');
    if (!knownIds.has(id)) throw new Error('UNKNOWN_EVIDENCE_ID');
    seen.add(id);
  }
}

export function resolveChallengeVotes(
  votes: readonly ChallengeVote[],
  keyPointIds: readonly string[],
): ChallengeResolution {
  const knownIds = new Set(keyPointIds);
  if (knownIds.size !== keyPointIds.length) throw new Error('DUPLICATE_KEY_POINT_ID');

  const validVotes = votes.filter((vote) => vote.valid);
  if (validVotes.length < 5) throw new Error('INSUFFICIENT_VALID_JUDGMENTS');

  const verdictCounts = new Map<JudgeVerdict, number>(VERDICTS.map((verdict) => [verdict, 0]));
  const coverageCounts = new Map<string, number>();
  for (const vote of validVotes) {
    if (!vote.verdict || !VERDICTS.includes(vote.verdict)) throw new Error('INVALID_VERDICT');
    const coveredIds = vote.coveredKeyPointIds ?? [];
    assertUniqueKnownIds(coveredIds, knownIds);
    verdictCounts.set(vote.verdict, (verdictCounts.get(vote.verdict) ?? 0) + 1);
    for (const id of coveredIds) coverageCounts.set(id, (coverageCounts.get(id) ?? 0) + 1);
  }

  const fourVoteVerdict = VERDICTS.find((verdict) => (verdictCounts.get(verdict) ?? 0) >= 4);
  const verdict = fourVoteVerdict
    ?? ((verdictCounts.get('IRRELEVANT') ?? 0) >= 2 ? 'IRRELEVANT' : 'BOTH');
  const coveredKeyPointIds = keyPointIds.filter((id) => (coverageCounts.get(id) ?? 0) >= 4);
  return { verdict, coveredKeyPointIds };
}

export function resolveEvidenceChallengeVotes(
  votes: readonly EvidenceChallengeVote[],
  evidenceIds: readonly string[],
): EvidenceChallengeResolution {
  const knownIds = new Set(evidenceIds);
  if (knownIds.size !== evidenceIds.length) throw new Error('DUPLICATE_EVIDENCE_ID');
  const validVotes = votes.filter((vote) => vote.valid);
  if (validVotes.length < 5) throw new Error('INSUFFICIENT_VALID_JUDGMENTS');

  const verdictCounts = new Map<JudgeVerdict, number>(VERDICTS.map((verdict) => [verdict, 0]));
  const evidenceCounts = new Map<string, number>();
  for (const vote of validVotes) {
    if (!vote.verdict || !VERDICTS.includes(vote.verdict)) throw new Error('INVALID_VERDICT');
    const established = vote.establishedEvidenceIds ?? [];
    assertUniqueKnownEvidenceIds(established, knownIds);
    verdictCounts.set(vote.verdict, (verdictCounts.get(vote.verdict) ?? 0) + 1);
    for (const id of established) evidenceCounts.set(id, (evidenceCounts.get(id) ?? 0) + 1);
  }

  const fourVoteVerdict = VERDICTS.find((verdict) => (verdictCounts.get(verdict) ?? 0) >= 4);
  const verdict = fourVoteVerdict
    ?? ((verdictCounts.get('IRRELEVANT') ?? 0) >= 2 ? 'IRRELEVANT' : 'BOTH');
  const establishedEvidenceIds = evidenceIds.filter((id) => (evidenceCounts.get(id) ?? 0) >= 4);
  return { verdict, establishedEvidenceIds };
}
