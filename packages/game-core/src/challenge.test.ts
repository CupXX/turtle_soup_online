import { describe, expect, it } from 'vitest';
import type { JudgeVerdict } from '@turtle-soup/contracts';
import { resolveChallengeVotes, type ChallengeVote } from './challenge.js';

const keyPointIds = ['kp-1', 'kp-2', 'kp-3'];

function vote(verdict: JudgeVerdict, coveredKeyPointIds: string[] = []): ChallengeVote {
  return { valid: true, verdict, coveredKeyPointIds };
}

describe('resolveChallengeVotes', () => {
  it('requires five valid judgments and uses a four-vote verdict majority', () => {
    expect(resolveChallengeVotes([
      vote('YES', ['kp-1']),
      vote('YES', ['kp-1']),
      vote('YES', ['kp-1']),
      vote('YES', ['kp-1']),
      vote('NO', ['kp-2']),
    ], keyPointIds)).toEqual({ verdict: 'YES', coveredKeyPointIds: ['kp-1'] });
  });

  it('falls back to IRRELEVANT when at least two votes are irrelevant', () => {
    expect(resolveChallengeVotes([
      vote('IRRELEVANT'),
      vote('IRRELEVANT'),
      vote('YES'),
      vote('NO'),
      vote('BOTH'),
    ], keyPointIds).verdict).toBe('IRRELEVANT');
  });

  it('falls back to BOTH otherwise and resolves coverage independently', () => {
    expect(resolveChallengeVotes([
      vote('BOTH', ['kp-1']),
      vote('YES', ['kp-1']),
      vote('NO', ['kp-1']),
      vote('IRRELEVANT', ['kp-1']),
      vote('YES'),
    ], keyPointIds)).toEqual({ verdict: 'BOTH', coveredKeyPointIds: ['kp-1'] });
  });

  it('ignores invalid judgments but refuses to resolve before five valid ones', () => {
    expect(() => resolveChallengeVotes([
      vote('YES'),
      { valid: false },
      vote('NO'),
      { valid: false },
      vote('BOTH'),
    ], keyPointIds)).toThrow('INSUFFICIENT_VALID_JUDGMENTS');
  });

  it('rejects duplicate and unknown key-point ids in a valid judgment', () => {
    expect(() => resolveChallengeVotes([
      vote('YES', ['kp-1', 'kp-1']), vote('YES'), vote('YES'), vote('YES'), vote('YES'),
    ], keyPointIds)).toThrow('DUPLICATE_KEY_POINT_ID');
    expect(() => resolveChallengeVotes([
      vote('YES', ['kp-x']), vote('YES'), vote('YES'), vote('YES'), vote('YES'),
    ], keyPointIds)).toThrow('UNKNOWN_KEY_POINT_ID');
  });
});
