import { findOrCreatePlayer, serializePlayerSessionCookie } from '@/server/auth/player-session';
import { getServerEnv } from '@/server/env';
import { apiError, ok } from '@/server/http/responses';
import { IdempotencyConflictError, claimIdempotency } from '@/server/security/idempotency';
import { InputValidationError, normalizeNickname, readJsonObject } from '@/server/security/input';
import { SameOriginError, assertSameOrigin } from '@/server/security/origin';
import { consumeRateLimit, hashRateLimitKey } from '@/server/security/rate-limit';

export const runtime = 'nodejs';

function requestAddress(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
}

function rateLimited(retryAfterSeconds: number): Response {
  const response = apiError('RATE_LIMITED', 429, true);
  response.headers.set('retry-after', String(retryAfterSeconds));
  return response;
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const nickname = normalizeNickname(body.nickname);
    const env = getServerEnv();
    const addressHash = hashRateLimitKey(requestAddress(request), env.ipHashSecret);
    const rate = await consumeRateLimit({
      bucket: `player-session:${addressHash}`,
      limit: env.rateLimits.playerJoinPerMinute,
      windowSeconds: 60,
    });
    if (!rate.allowed) {
      return rateLimited(rate.retryAfterSeconds);
    }

    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) {
      throw new InputValidationError('Idempotency-Key is required');
    }
    await claimIdempotency({
      actorScope: `ip:${addressHash}`,
      operation: 'PLAYER_SESSION',
      key: idempotencyKey,
      payload: { nicknameKey: nickname.key },
    });

    const player = await findOrCreatePlayer(nickname);
    const response = ok({ playerId: player.id, displayNickname: player.displayNickname });
    response.headers.set('set-cookie', serializePlayerSessionCookie(player.id, env));
    return response;
  } catch (error) {
    if (error instanceof SameOriginError) {
      return apiError('VALIDATION_ERROR', 403, false);
    }
    if (error instanceof InputValidationError) {
      return apiError('VALIDATION_ERROR', 400, false);
    }
    if (error instanceof IdempotencyConflictError) {
      return apiError('IDEMPOTENCY_CONFLICT', 409, false);
    }
    return apiError('INTERNAL_ERROR', 500, true);
  }
}
