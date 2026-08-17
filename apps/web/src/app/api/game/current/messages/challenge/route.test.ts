import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayerSessionToken } from '@/server/auth/player-session';

const mocks = vi.hoisted(() => ({
  claimIdempotency: vi.fn(),
  bindIdempotencyResult: vi.fn(),
  submitChallenge: vi.fn(),
  getChallengeById: vi.fn(),
  ChallengeInProgressError: class extends Error {},
  ChallengeAlreadySubmittedError: class extends Error {},
  ChallengeMessageNotFoundError: class extends Error {},
  ChallengeJudgmentUnavailableError: class extends Error {},
}));

vi.mock('@/server/security/idempotency', () => ({
  claimIdempotency: mocks.claimIdempotency,
  bindIdempotencyResult: mocks.bindIdempotencyResult,
  computePayloadDigest: vi.fn(() => 'digest'),
  IdempotencyConflictError: class extends Error {},
}));
vi.mock('@/server/game/submit-challenge', () => ({
  submitChallenge: mocks.submitChallenge,
  getChallengeById: mocks.getChallengeById,
  ChallengeInProgressError: mocks.ChallengeInProgressError,
  ChallengeAlreadySubmittedError: mocks.ChallengeAlreadySubmittedError,
  ChallengeMessageNotFoundError: mocks.ChallengeMessageNotFoundError,
  ChallengeJudgmentUnavailableError: mocks.ChallengeJudgmentUnavailableError,
}));

import { POST } from './route.js';

const originalEnv = { ...process.env };
const playerSecret = 'player-session-secret';
const playerId = '00000000-0000-4000-8000-000000000001';
const messageId = '00000000-0000-4000-8000-000000000002';
const challengeId = '00000000-0000-4000-8000-000000000003';
const idempotencyKey = '00000000-0000-4000-8000-000000000004';

afterEach(() => {
  process.env = { ...originalEnv };
  mocks.claimIdempotency.mockReset();
  mocks.bindIdempotencyResult.mockReset();
  mocks.submitChallenge.mockReset();
  mocks.getChallengeById.mockReset();
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

function request() {
  return new Request('http://localhost:3000/api/game/current/messages/challenge', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      cookie: playerCookie(),
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ messageId }),
  });
}

describe('POST /api/game/current/messages/challenge', () => {
  it('queues a challenge and binds the challenge receipt for replay', async () => {
    validEnv();
    mocks.claimIdempotency.mockResolvedValue({ kind: 'NEW' });
    mocks.submitChallenge.mockResolvedValue({ challengeId, messageId, status: 'PENDING' });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { challengeId, messageId, status: 'PENDING' } });
    expect(mocks.submitChallenge).toHaveBeenCalledWith(expect.objectContaining({ playerId, messageId, payloadDigest: 'digest' }));
    expect(mocks.bindIdempotencyResult).toHaveBeenCalledWith(expect.objectContaining({
      resultResourceId: challengeId,
      responseStatus: 200,
    }));
  });

  it('returns the existing receipt for an idempotency replay', async () => {
    validEnv();
    mocks.claimIdempotency.mockResolvedValue({ kind: 'REPLAY', resultResourceId: challengeId, responseStatus: 200 });
    mocks.getChallengeById.mockResolvedValue({ challengeId, messageId, status: 'RESOLVED' });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { challengeId, messageId, status: 'RESOLVED' } });
    expect(mocks.submitChallenge).not.toHaveBeenCalled();
  });

  it('maps a concurrent challenge to a retryable conflict', async () => {
    validEnv();
    mocks.claimIdempotency.mockResolvedValue({ kind: 'NEW' });
    mocks.submitChallenge.mockRejectedValue(new mocks.ChallengeInProgressError());

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'CHALLENGE_IN_PROGRESS', retryable: true } });
  });

  it('maps a repeat challenge to a non-retryable conflict', async () => {
    validEnv();
    mocks.claimIdempotency.mockResolvedValue({ kind: 'NEW' });
    mocks.submitChallenge.mockRejectedValue(new mocks.ChallengeAlreadySubmittedError());

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'CHALLENGE_ALREADY_SUBMITTED', retryable: false } });
  });
});
