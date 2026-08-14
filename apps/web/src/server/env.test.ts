import { afterEach, describe, expect, it } from 'vitest';
import { getServerEnv } from './env.js';

const originalEnv = { ...process.env };

function setValidEnv() {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    GAME_WEB_DATABASE_URL: 'postgresql://user:password@example.test:5432/game',
    SITE_ORIGIN: 'http://localhost:3000',
    PLAYER_SESSION_SECRET: 'player-secret-012345',
    ADMIN_SESSION_SECRET: 'admin-secret-012345',
    ADMIN_SECRET: 'admin-login-secret',
    IDEMPOTENCY_HMAC_SECRET: 'idempotency-secret',
    IP_HASH_SECRET: 'ip-hash-secret-01',
    RATE_LIMIT_PLAYER_JOIN_PER_MINUTE: '10',
    RATE_LIMIT_MESSAGE_PER_PLAYER_PER_MINUTE: '12',
    RATE_LIMIT_MESSAGE_PER_IP_PER_MINUTE: '30',
    RATE_LIMIT_FINAL_ANSWER_PER_PLAYER_PER_5_MINUTES: '3',
    RATE_LIMIT_ADMIN_LOGIN_PER_IP_PER_15_MINUTES: '5',
    RATE_LIMIT_ADMIN_WRITE_PER_SESSION_PER_MINUTE: '10',
  };
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('getServerEnv', () => {
  it('returns normalized server configuration and rate limits', () => {
    setValidEnv();

    expect(getServerEnv()).toMatchObject({
      supabaseUrl: 'https://example.supabase.co',
      gameWebDatabaseUrl: 'postgresql://user:password@example.test:5432/game',
      rateLimits: {
        playerJoinPerMinute: 10,
        finalAnswerPerPlayerPerFiveMinutes: 3,
      },
    });
  });

  it('rejects missing secrets without echoing secret values', () => {
    setValidEnv();
    delete process.env.PLAYER_SESSION_SECRET;

    expect(() => getServerEnv()).toThrow(/PLAYER_SESSION_SECRET/);
    expect(() => getServerEnv()).toThrow(/Invalid server configuration/);
    expect(() => getServerEnv()).not.toThrow(/player-secret/);
  });

  it('rejects invalid database URLs and rate limits', () => {
    setValidEnv();
    process.env.GAME_WEB_DATABASE_URL = 'https://not-postgres.test';
    process.env.RATE_LIMIT_MESSAGE_PER_IP_PER_MINUTE = '0';

    expect(() => getServerEnv()).toThrow(/GAME_WEB_DATABASE_URL/);
    expect(() => getServerEnv()).toThrow(/RATE_LIMIT_MESSAGE_PER_IP_PER_MINUTE/);
  });
});
