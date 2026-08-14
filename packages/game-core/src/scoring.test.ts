import { describe, expect, it } from 'vitest';
import { calculateHitRate, finalAnswerReward, newClaimScore } from './scoring.js';

describe('calculateHitRate', () => {
  it('uses only YES results as the numerator', () => {
    expect(calculateHitRate(3, 10)).toBe(0.3);
    expect(calculateHitRate(0, 10)).toBe(0);
  });

  it('returns null when no questions have been received', () => {
    expect(calculateHitRate(0, 0)).toBeNull();
  });
});

describe('newClaimScore', () => {
  it('awards one point per distinct newly inserted claim', () => {
    expect(newClaimScore(['point-a', 'point-b', 'point-a'])).toBe(2);
    expect(newClaimScore([])).toBe(0);
  });
});

describe('finalAnswerReward', () => {
  it('awards +2 only for a successful final answer', () => {
    expect(finalAnswerReward('SUCCESS')).toBe(2);
    expect(finalAnswerReward('FAILED')).toBe(0);
    expect(finalAnswerReward('FORCE_ENDED')).toBe(0);
  });
});
