import { describe, expect, it } from 'vitest';
import { assertSameOrigin } from './origin.js';

describe('same-origin protection', () => {
  it('accepts the configured origin and rejects absent or different origins', () => {
    expect(() => assertSameOrigin(new Request('http://localhost', {
      headers: { origin: 'http://localhost:3000' },
    }), 'http://localhost:3000')).not.toThrow();
    expect(() => assertSameOrigin(new Request('http://localhost', {
      headers: { origin: 'https://attacker.example' },
    }), 'http://localhost:3000')).toThrow();
    expect(() => assertSameOrigin(new Request('http://localhost'), 'http://localhost:3000')).toThrow();
  });
});
