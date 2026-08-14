import { describe, expect, it } from 'vitest';
import { isFinalAnswerSuccessful } from './final-answer.js';

describe('isFinalAnswerSuccessful', () => {
  const allIds = ['a', 'b', 'c', 'd'];

  it('rejects an answer that covers only three of four points', () => {
    expect(isFinalAnswerSuccessful(allIds, ['a', 'b', 'c'])).toBe(false);
  });

  it('accepts exactly all four points, regardless of order or duplicates', () => {
    expect(isFinalAnswerSuccessful(allIds, ['d', 'b', 'a', 'c', 'a'])).toBe(true);
  });

  it('rejects unknown IDs even when the submitted count matches', () => {
    expect(isFinalAnswerSuccessful(allIds, ['a', 'b', 'c', 'unknown'])).toBe(false);
  });
});
