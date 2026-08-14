import { readPlayerSession } from '@/server/auth/player-session';
import { withWebTransaction } from '@/server/db/client';
import { getServerEnv } from '@/server/env';
import { joinCurrentGame } from '@/server/game/join-current-game';
import { apiError, ok } from '@/server/http/responses';
import { IdempotencyConflictError, claimIdempotency } from '@/server/security/idempotency';
import { InputValidationError, readJsonObject } from '@/server/security/input';
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
    await readJsonObject(request);
    const env = getServerEnv();
    const playerId = readPlayerSession(request, env.playerSessionSecret);
    if (!playerId) return apiError('PLAYER_SESSION_REQUIRED', 401, false);

    const addressHash = hashRateLimitKey(requestAddress(request), env.ipHashSecret);
    const rate = await consumeRateLimit({
      bucket: `player-join:${addressHash}`,
      limit: env.rateLimits.playerJoinPerMinute,
      windowSeconds: 60,
    });
    if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

    const idempotencyKey = request.headers.get('Idempotency-Key');
    const claim = await claimIdempotency({
      actorScope: `player:${playerId}`,
      operation: 'GAME_JOIN',
      key: idempotencyKey ?? '',
      payload: {},
    });

    // A replay repeats the harmless INSERT ... ON CONFLICT DO NOTHING. This
    // also works with the current idempotency store, which records the receipt
    // before the game id is known.
    void claim;
    const result = await withWebTransaction((sql) => joinCurrentGame(sql, playerId));
    if (!result) return apiError('NO_CURRENT_GAME', 409, true);
    return ok(result);
  } catch (error) {
    if (error instanceof SameOriginError) return apiError('VALIDATION_ERROR', 403, false);
    if (error instanceof InputValidationError) return apiError('VALIDATION_ERROR', 400, false);
    if (error instanceof IdempotencyConflictError) return apiError('IDEMPOTENCY_CONFLICT', 409, false);
    return apiError('INTERNAL_ERROR', 500, true);
  }
}
