import { describe, expect, it } from 'vitest';
import { reactionForVerdict } from './verdict.js';

describe('reactionForVerdict', () => {
  it.each([
    ['YES', '✅'],
    ['NO', '❌'],
    ['BOTH', '❓'],
    ['IRRELEVANT', '👎'],
  ] as const)('maps %s to its deterministic reaction', (verdict, reaction) => {
    expect(reactionForVerdict(verdict)).toBe(reaction);
  });
});
