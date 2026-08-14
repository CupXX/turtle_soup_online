import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayerSessionToken } from '@/server/auth/player-session';
import { InputValidationError } from '@/server/security/input';

const mocks = vi.hoisted(() => ({
  claimIdempotency: vi.fn(),
  bindIdempotencyResult: vi.fn(),
  consumeRateLimit: vi.fn(),
  submitMessage: vi.fn(),
  getPublicMessageById: vi.fn(),
}));

vi.mock('@/server/security/idempotency', () => ({
  claimIdempotency: mocks.claimIdempotency,
  bindIdempotencyResult: mocks.bindIdempotencyResult,
  computePayloadDigest: vi.fn(() => 'digest'),
  IdempotencyConflictError: class extends Error {},
}));
vi.mock('@/server/security/rate-limit', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  hashRateLimitKey: vi.fn(() => 'hashed-address'),
}));
vi.mock('@/server/game/submit-message', () => ({
  submitMessage: mocks.submitMessage,
  getPublicMessageById: mocks.getPublicMessageById,
  GameNotActiveError: class extends Error {},
  WorkerUnavailableError: class extends Error {},
}));

import { POST } from './route.js';

const originalEnv = { ...process.env };
const playerSecret = 'player-session-secret';
const playerId = '00000000-0000-4000-8000-000000000001';

afterEach(() => {
  process.env = { ...originalEnv };
  mocks.claimIdempotency.mockReset();
  mocks.bindIdempotencyResult.mockReset();
  mocks.consumeRateLimit.mockReset();
  mocks.submitMessage.mockReset();
  mocks.getPublicMessageById.mockReset();
});

function validEnv() {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    GAME_WEB_DATABASE_URL: 'postgresql://user:password@example.test:5432/game',
    SITE_ORIGIN: 'http://localhost:3000',
    PLAYER_SESSION_SECRET: playerSecret,
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

function playerCookie() {
  return `turtle_soup_player=${createPlayerSessionToken(playerId, playerSecret)}`;
}

describe('POST /api/game/current/messages', () => {
  it('validates the player session and returns the public PENDING row', async () => {
    validEnv();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 10 });
    mocks.claimIdempotency.mockResolvedValue({ kind: 'NEW' });
    mocks.bindIdempotencyResult.mockResolvedValue(undefined);
    mocks.submitMessage.mockResolvedValue({ id: 'message-1', status: 'PENDING', content: 'question' });

    const response = await POST(new Request('http://localhost:3000/api/game/current/messages', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        cookie: playerCookie(),
        'content-type': 'application/json',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000010',
      },
      body: JSON.stringify({ content: 'question' }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { id: 'message-1', status: 'PENDING', content: 'question' } });
    expect(mocks.submitMessage).toHaveBeenCalledWith(expect.objectContaining({ playerId, content: 'question', payloadDigest: 'digest' }));
    expect(mocks.bindIdempotencyResult).toHaveBeenCalledWith(expect.objectContaining({ resultResourceId: 'message-1', responseStatus: 200 }));
  });

  it('enforces both player and IP message limits before persistence', async () => {
    validEnv();
    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 9 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 17 });

    const response = await POST(new Request('http://localhost:3000/api/game/current/messages', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        cookie: playerCookie(),
        'content-type': 'application/json',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000010',
      },
      body: JSON.stringify({ content: 'question' }),
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('17');
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.submitMessage).not.toHaveBeenCalled();
  });

  it('loads the same public message for an idempotency replay', async () => {
    validEnv();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 10 });
    mocks.claimIdempotency.mockResolvedValue({ kind: 'REPLAY', resultResourceId: 'message-1', responseStatus: 200 });
    mocks.getPublicMessageById.mockResolvedValue({ id: 'message-1', status: 'PENDING', content: 'question' });

    const response = await POST(new Request('http://localhost:3000/api/game/current/messages', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        cookie: playerCookie(),
        'content-type': 'application/json',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000010',
      },
      body: JSON.stringify({ content: 'question' }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { id: 'message-1', status: 'PENDING', content: 'question' } });
    expect(mocks.submitMessage).not.toHaveBeenCalled();
  });

  it('returns validation error for a missing or invalid idempotency claim', async () => {
    validEnv();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 10 });
    mocks.claimIdempotency.mockRejectedValue(new InputValidationError());

    const response = await POST(new Request('http://localhost:3000/api/game/current/messages', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        cookie: playerCookie(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: 'question' }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.submitMessage).not.toHaveBeenCalled();
  });
});
