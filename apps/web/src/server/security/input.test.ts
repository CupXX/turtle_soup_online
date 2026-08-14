import { describe, expect, it } from 'vitest';
import { normalizeBoundedText, normalizeNickname, readJsonObject } from './input.js';

describe('input validation', () => {
  it('normalizes display text and a case-insensitive nickname key', () => {
    expect(normalizeNickname('  Ｃups  ')).toEqual({ display: 'Cups', key: 'cups' });
  });

  it('rejects control characters and length violations', () => {
    expect(() => normalizeNickname('hello\nworld')).toThrow();
    expect(() => normalizeNickname('')).toThrow();
    expect(() => normalizeNickname('a'.repeat(25))).toThrow();
    expect(() => normalizeBoundedText('a'.repeat(6), 5, 'message')).toThrow(/message/);
  });

  it('requires a JSON object body', async () => {
    await expect(
      readJsonObject(new Request('http://localhost', { body: '[]', method: 'POST' })),
    ).rejects.toThrow();
    await expect(
      readJsonObject(
        new Request('http://localhost', {
          body: JSON.stringify({ nickname: 'Cups' }),
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ).resolves.toEqual({ nickname: 'Cups' });
  });
});
