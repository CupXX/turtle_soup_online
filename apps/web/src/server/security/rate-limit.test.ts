import { describe, expect, it } from 'vitest';
import { consumeRateLimit, hashRateLimitKey, type RateLimitStore } from './rate-limit.js';

describe('rate limits', () => {
  it('hashes raw IP input before it becomes a bucket key', () => {
    expect(hashRateLimitKey('192.0.2.1', 'ip-secret')).not.toContain('192.0.2.1');
    expect(hashRateLimitKey('192.0.2.1', 'ip-secret')).toBe(hashRateLimitKey('192.0.2.1', 'ip-secret'));
  });

  it('returns remaining capacity and a Retry-After value when blocked', async () => {
    const store: RateLimitStore = {
      async increment() {
        return { count: 3, resetAt: new Date('2026-08-14T12:01:00.000Z') };
      },
    };
    const now = new Date('2026-08-14T12:00:30.000Z');

    await expect(consumeRateLimit({ bucket: 'bucket', limit: 5, windowSeconds: 60 }, { store, now }))
      .resolves.toEqual({ allowed: true, remaining: 2 });

    const blockedStore: RateLimitStore = {
      async increment() {
        return { count: 6, resetAt: new Date('2026-08-14T12:01:00.000Z') };
      },
    };
    await expect(consumeRateLimit({ bucket: 'bucket', limit: 5, windowSeconds: 60 }, { store: blockedStore, now }))
      .resolves.toEqual({ allowed: false, retryAfterSeconds: 30 });
  });
});
