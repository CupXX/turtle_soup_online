import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminSessionToken } from '@/server/auth/admin-session';
import { InputValidationError } from '@/server/security/input';

const mocks = vi.hoisted(() => ({
  claimIdempotency: vi.fn(),
  bindIdempotencyResult: vi.fn(),
  consumeRateLimit: vi.fn(),
  getCurrentAdminGameId: vi.fn(),
  forceEndGame: vi.fn(),
}));

vi.mock('@/server/security/idempotency', () => ({
  claimIdempotency: mocks.claimIdempotency,
  bindIdempotencyResult: mocks.bindIdempotencyResult,
  IdempotencyConflictError: class extends Error {},
}));
vi.mock('@/server/security/rate-limit', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  hashRateLimitKey: vi.fn(() => 'hashed-address'),
}));
vi.mock('@/server/game/admin-lifecycle', () => ({
  getCurrentAdminGameId: mocks.getCurrentAdminGameId,
  forceEndGame: mocks.forceEndGame,
  GameLifecycleStateError: class extends Error {},
}));

import { POST } from './route.js';

const originalEnv = { ...process.env };
const adminSecret = 'admin-session-secret';
const gameId = '00000000-0000-4000-8000-000000000001';

afterEach(() => {
  process.env = { ...originalEnv };
  Object.values(mocks).forEach((mock) => mock.mockReset());
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

function request(body: unknown = { confirmation: 'FORCE_END' }) {
  const token = createAdminSessionToken('admin', adminSecret);
  return new Request('http://localhost:3000/api/admin/games/current/force-end', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: `turtle_soup_admin=${token}`,
      'content-type': 'application/json',
      'Idempotency-Key': '00000000-0000-4000-8000-000000000010',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/games/current/force-end', () => {
  it('requires the explicit phrase and returns only the ended status', async () => {
    validEnv();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    mocks.claimIdempotency.mockResolvedValue({ kind: 'NEW' });
    mocks.getCurrentAdminGameId.mockResolvedValue(gameId);
    mocks.forceEndGame.mockResolvedValue({ status: 'ENDED', endReason: 'FORCE_ENDED' });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { status: 'ENDED', endReason: 'FORCE_ENDED' } });
    expect(mocks.forceEndGame).toHaveBeenCalledWith(gameId);
    expect(mocks.bindIdempotencyResult).toHaveBeenCalledWith(expect.objectContaining({ resultResourceId: gameId }));
  });

  it('rejects a wrong confirmation before ending anything', async () => {
    validEnv();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });

    const response = await POST(request({ confirmation: 'END' }));

    expect(response.status).toBe(400);
    expect(mocks.forceEndGame).not.toHaveBeenCalled();
  });

  it('replays without mutating lifecycle state', async () => {
    validEnv();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    mocks.claimIdempotency.mockResolvedValue({ kind: 'REPLAY', resultResourceId: gameId, responseStatus: 200 });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { status: 'ENDED', endReason: 'FORCE_ENDED' } });
    expect(mocks.forceEndGame).not.toHaveBeenCalled();
  });
});
