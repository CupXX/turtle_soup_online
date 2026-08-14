import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminSessionToken } from '@/server/auth/admin-session';

const mocks = vi.hoisted(() => ({
  claimIdempotency: vi.fn(),
  consumeRateLimit: vi.fn(),
  createPreparation: vi.fn(),
}));

vi.mock('@/server/security/idempotency', () => ({
  claimIdempotency: mocks.claimIdempotency,
  IdempotencyConflictError: class extends Error {},
}));
vi.mock('@/server/security/rate-limit', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  hashRateLimitKey: vi.fn(() => 'hashed-address'),
}));
vi.mock('@/server/game/admin-lifecycle', () => ({
  createPreparation: mocks.createPreparation,
  GameAlreadyOpenError: class extends Error {},
  WorkerUnavailableError: class extends Error {},
}));

import { POST } from './route.js';

const originalEnv = { ...process.env };
const adminSecret = 'admin-session-secret';

afterEach(() => {
  process.env = { ...originalEnv };
  mocks.claimIdempotency.mockReset();
  mocks.consumeRateLimit.mockReset();
  mocks.createPreparation.mockReset();
});

function validEnv() {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    GAME_WEB_DATABASE_URL: 'postgresql://user:password@example.test:5432/game',
    SITE_ORIGIN: 'http://localhost:3000',
    PLAYER_SESSION_SECRET: 'player-session-secret',
    ADMIN_SESSION_SECRET: adminSecret,
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

function adminCookie() {
  const token = createAdminSessionToken('主持人', adminSecret);
  return `turtle_soup_admin=${token}`;
}

describe('POST /api/admin/games', () => {
  it('rejects missing admin session before accepting the private solution', async () => {
    validEnv();
    const response = await POST(new Request('http://localhost:3000/api/admin/games', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ puzzleSurface: '题面', fullSolution: '答案' }),
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'ADMIN_SESSION_REQUIRED' } });
    expect(mocks.createPreparation).not.toHaveBeenCalled();
  });

  it('creates a WAITING game through the lifecycle boundary and never echoes the solution', async () => {
    validEnv();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    mocks.claimIdempotency.mockResolvedValue({ kind: 'NEW' });
    mocks.createPreparation.mockResolvedValue({ gameId: '00000000-0000-4000-8000-000000000001', status: 'WAITING' });

    const response = await POST(new Request('http://localhost:3000/api/admin/games', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        cookie: adminCookie(),
        'content-type': 'application/json',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000010',
      },
      body: JSON.stringify({ puzzleSurface: '题面', fullSolution: '答案不可回显' }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: { gameId: '00000000-0000-4000-8000-000000000001', status: 'WAITING' } });
    expect(JSON.stringify(body)).not.toContain('答案不可回显');
    expect(mocks.createPreparation).toHaveBeenCalledWith({ puzzleSurface: '题面', fullSolution: '答案不可回显' });
  });
});
