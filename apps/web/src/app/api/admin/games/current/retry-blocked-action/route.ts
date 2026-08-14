import { readAdminSession } from '@/server/auth/admin-session';
import { getDb } from '@/server/db/client';
import { getServerEnv } from '@/server/env';
import { BlockedActionRetryError, GameLifecycleStateError, getCurrentAdminGameId, retryBlockedAction, WorkerUnavailableError } from '@/server/game/admin-lifecycle';
import { apiError, ok } from '@/server/http/responses';
import { bindIdempotencyResult, claimIdempotency, IdempotencyConflictError } from '@/server/security/idempotency';
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
    const env = getServerEnv();
    const adminNickname = readAdminSession(request, env.adminSessionSecret);
    if (!adminNickname) return apiError('ADMIN_SESSION_REQUIRED', 401, false);
    await readJsonObject(request);
    const addressHash = hashRateLimitKey(requestAddress(request), env.ipHashSecret);
    const rate = await consumeRateLimit({ bucket: `admin-write:${adminNickname}:${addressHash}`, limit: env.rateLimits.adminWritePerSessionPerMinute, windowSeconds: 60 });
    if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

    const actorScope = `admin:${adminNickname}`;
    const operation = 'RETRY_BLOCKED_ACTION';
    const key = request.headers.get('Idempotency-Key') ?? '';
    const claim = await claimIdempotency({ actorScope, operation, key, payload: {} }, { responseStatus: 200 });
    if (claim.kind === 'REPLAY' && claim.resultResourceId) return ok({ status: 'RETRY' as const });

    const gameId = await getCurrentAdminGameId(getDb());
    if (!gameId) return apiError('NO_CURRENT_GAME', 409, true);
    await retryBlockedAction(gameId);
    if (claim.kind === 'NEW') await bindIdempotencyResult({ actorScope, operation, key, resultResourceId: gameId, responseStatus: 200 });
    return ok({ status: 'RETRY' as const });
  } catch (error) {
    if (error instanceof SameOriginError) return apiError('VALIDATION_ERROR', 403, false);
    if (error instanceof InputValidationError) return apiError('VALIDATION_ERROR', 400, false);
    if (error instanceof IdempotencyConflictError) return apiError('IDEMPOTENCY_CONFLICT', 409, false);
    if (error instanceof WorkerUnavailableError) return apiError('JUDGE_UNAVAILABLE', 503, true);
    if (error instanceof BlockedActionRetryError) return apiError('QUEUE_BLOCKED', 409, true);
    if (error instanceof GameLifecycleStateError) return apiError(error.message === 'NO_CURRENT_GAME' ? 'NO_CURRENT_GAME' : 'GAME_NOT_ACTIVE', 409, true);
    return apiError('INTERNAL_ERROR', 500, true);
  }
}
