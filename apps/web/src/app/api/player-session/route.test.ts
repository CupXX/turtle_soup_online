import { afterEach, describe, expect, it } from 'vitest';
import { POST } from './route.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function validEnv() {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    GAME_WEB_DATABASE_URL: 'postgresql://user:password@example.test:5432/game',
    SITE_ORIGIN: 'http://localhost:3000',
    PLAYER_SESSION_SECRET: 'player-session-secret',
    ADMIN_SESSION_SECRET: 'admin-session-secret',
    ADMIN_SECRET: 'admin-login-secret',
    IDEMPOTENCY_HMAC_SECRET: 'idempotency-hmac-secret',
    IP_HASH_SECRET: 'ip-hash-secret-01',
    RATE_LIMIT_PLAYER_JOIN_PER_MINUTE: '10',
    RATE_LIMIT_MESSAGE_PER_PLAYER_PER_MINUTE: '12',
    RATE_LIMIT_MESSAGE_PER_IP_PER_MINUTE: '30',
    RATE_LIMIT_FINAL_ANSWER_PER_PLAYER_PER_5_MINUTES: '3',
    RATE_LIMIT_ADMIN_LOGIN_PER_IP_PER_15_MINUTES: '5',
    RATE_LIMIT_ADMIN_WRITE_PER_SESSION_PER_MINUTE: '10',
  };
}

describe('POST /api/player-session', () => {
  it('rejects a cross-origin request before touching persistence', async () => {
    validEnv();
    const response = await POST(new Request('http://localhost:3000/api/player-session', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ nickname: 'Cups' }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
