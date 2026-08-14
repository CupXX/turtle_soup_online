import { describe, expect, it } from 'vitest';
import { canAcceptGameplayAction } from './lifecycle.js';

describe('canAcceptGameplayAction', () => {
  it('accepts actions only while the game is active', () => {
    expect(canAcceptGameplayAction('ACTIVE')).toBe(true);
    expect(canAcceptGameplayAction('WAITING')).toBe(false);
    expect(canAcceptGameplayAction('ENDED')).toBe(false);
  });
});
