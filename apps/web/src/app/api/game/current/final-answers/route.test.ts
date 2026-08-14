import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayerSessionToken } from '@/server/auth/player-session';
import { InputValidationError } from '@/server/security/input';

const mocks = vi.hoisted(() => ({
  claimIdempotency: vi.fn(),
  bindIdempotencyResult: vi.fn(),
  consumeRateLimit: vi.fn(),
  submitFinalAnswer: vi.fn(),
  getFinalAnswerReceiptById: vi.fn(),
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
vi.mock('@/server/game/submit-final-answer', () => ({
  submitFinalAnswer: mocks.submitFinalAnswer,
  getFinalAnswerReceiptById: mocks.getFinalAnswerReceiptById,
  GameNotActiveError: class extends Error {},
  WorkerUnavailableError: class extends Error {},
}));

import { POST } from './route.js';

const originalEnv = { ...process.env };
const playerSecret = 'player-session-secret';
const playerId = '00000000-0000-4000-8000-000000000001';

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

function request(body: unknown, key = '00000000-0000-4000-8000-000000000010') {
  return new Request('http://localhost:3000/api/game/current/final-answers', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: playerCookie(),
      'content-type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/game/current/final-answers', () => {
  it('returns only the safe pending receipt and binds request idempotency', async () => {
    validEnv();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mocks.claimIdempotency.mockResolvedValue({ kind: 'NEW' });
    mocks.submitFinalAnswer.mockResolvedValue({ submissionId: 'submission-1', gameId: 'game-1', playerId, sequenceNo: 6, status: 'PENDING' });

    const response = await POST(request({ answer: 'private answer' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: { submissionId: 'submission-1', gameId: 'game-1', playerId, sequenceNo: 6, status: 'PENDING' } });
    expect(JSON.stringify(body)).not.toContain('private answer');
    expect(mocks.submitFinalAnswer).toHaveBeenCalledWith(expect.objectContaining({ playerId, answer: 'private answer', payloadDigest: 'digest' }));
    expect(mocks.bindIdempotencyResult).toHaveBeenCalledWith(expect.objectContaining({ resultResourceId: 'submission-1', responseStatus: 200 }));
  });

  it('enforces the final-answer rate limit before persistence', async () => {
    validEnv();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });

    const response = await POST(request({ answer: 'answer' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(mocks.submitFinalAnswer).not.toHaveBeenCalled();
  });

  it('replays a safe receipt without calling the write transaction', async () => {
    validEnv();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mocks.claimIdempotency.mockResolvedValue({ kind: 'REPLAY', resultResourceId: 'submission-1', responseStatus: 200 });
    mocks.getFinalAnswerReceiptById.mockResolvedValue({ submissionId: 'submission-1', gameId: 'game-1', playerId, sequenceNo: 6, status: 'PENDING' });

    const response = await POST(request({ answer: 'answer' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { submissionId: 'submission-1', gameId: 'game-1', playerId, sequenceNo: 6, status: 'PENDING' } });
    expect(mocks.submitFinalAnswer).not.toHaveBeenCalled();
  });

  it('returns validation for a missing or invalid idempotency key', async () => {
    validEnv();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mocks.claimIdempotency.mockRejectedValue(new InputValidationError());

    const response = await POST(request({ answer: 'answer' }, ''));

    expect(response.status).toBe(400);
    expect(mocks.submitFinalAnswer).not.toHaveBeenCalled();
  });
});

