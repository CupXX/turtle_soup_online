import { readAdminSession } from '@/server/auth/admin-session';
import { getServerEnv } from '@/server/env';
import { createPreparation, GameAlreadyOpenError, WorkerUnavailableError } from '@/server/game/admin-lifecycle';
import { apiError, ok } from '@/server/http/responses';
import { IdempotencyConflictError, claimIdempotency } from '@/server/security/idempotency';
import { InputValidationError, normalizeBoundedText, readJsonObject } from '@/server/security/input';
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

    const body = await readJsonObject(request);
    const puzzleSurface = normalizeBoundedText(body.puzzleSurface, 2000, 'puzzleSurface');
    const fullSolution = normalizeBoundedText(body.fullSolution, 8000, 'fullSolution');
    const addressHash = hashRateLimitKey(requestAddress(request), env.ipHashSecret);
    const rate = await consumeRateLimit({
      bucket: `admin-write:${adminNickname}:${addressHash}`,
      limit: env.rateLimits.adminWritePerSessionPerMinute,
      windowSeconds: 60,
    });
    if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

    const claim = await claimIdempotency({
      actorScope: `admin:${adminNickname}`,
      operation: 'CREATE_GAME',
      key: request.headers.get('Idempotency-Key') ?? '',
      payload: { puzzleSurface, fullSolution },
    });
    if (claim.kind === 'REPLAY') {
      return ok({ gameId: claim.resultResourceId || null, status: 'WAITING' as const });
    }

    const result = await createPreparation({ puzzleSurface, fullSolution });
    return ok(result);
  } catch (error) {
    if (error instanceof SameOriginError) return apiError('VALIDATION_ERROR', 403, false);
    if (error instanceof InputValidationError) return apiError('VALIDATION_ERROR', 400, false);
    if (error instanceof IdempotencyConflictError) return apiError('IDEMPOTENCY_CONFLICT', 409, false);
    if (error instanceof GameAlreadyOpenError) return apiError('GAME_ALREADY_ACTIVE', 409, false);
    if (error instanceof WorkerUnavailableError) return apiError('JUDGE_UNAVAILABLE', 503, true);
    return apiError('INTERNAL_ERROR', 500, true);
  }
}
