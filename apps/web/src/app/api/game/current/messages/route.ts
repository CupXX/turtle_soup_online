import { readPlayerSession } from '@/server/auth/player-session';
import { getServerEnv } from '@/server/env';
import {
  getPublicMessageById,
  GameNotActiveError,
  submitMessage,
  WorkerUnavailableError,
} from '@/server/game/submit-message';
import { apiError, ok } from '@/server/http/responses';
import {
  bindIdempotencyResult,
  claimIdempotency,
  computePayloadDigest,
  IdempotencyConflictError,
} from '@/server/security/idempotency';
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
    const playerId = readPlayerSession(request, env.playerSessionSecret);
    if (!playerId) return apiError('PLAYER_SESSION_REQUIRED', 401, false);

    const body = await readJsonObject(request);
    const content = normalizeBoundedText(body.content, 500, 'content');
    const idempotencyKey = request.headers.get('Idempotency-Key') ?? '';
    const payloadDigest = computePayloadDigest({ content }, env.idempotencyHmacSecret);
    const addressHash = hashRateLimitKey(requestAddress(request), env.ipHashSecret);

    const playerRate = await consumeRateLimit({
      bucket: `message-player:${playerId}`,
      limit: env.rateLimits.messagePerPlayerPerMinute,
      windowSeconds: 60,
    });
    if (!playerRate.allowed) return rateLimited(playerRate.retryAfterSeconds);

    const ipRate = await consumeRateLimit({
      bucket: `message-ip:${addressHash}`,
      limit: env.rateLimits.messagePerIpPerMinute,
      windowSeconds: 60,
    });
    if (!ipRate.allowed) return rateLimited(ipRate.retryAfterSeconds);

    const actorScope = `player:${playerId}`;
    const operation = 'MESSAGE';
    const claim = await claimIdempotency({
      actorScope,
      operation,
      key: idempotencyKey,
      payload: { content },
    }, { responseStatus: 200 });

    if (claim.kind === 'REPLAY' && claim.resultResourceId) {
      const result = await getPublicMessageById(claim.resultResourceId);
      if (!result) return apiError('INTERNAL_ERROR', 500, true);
      return ok(result);
    }

    const result = await submitMessage({ playerId, content, idempotencyKey, payloadDigest });
    if (claim.kind === 'NEW') {
      await bindIdempotencyResult({
        actorScope,
        operation,
        key: idempotencyKey,
        resultResourceId: result.id,
        responseStatus: 200,
      });
    }
    return ok(result);
  } catch (error) {
    if (error instanceof SameOriginError) return apiError('VALIDATION_ERROR', 403, false);
    if (error instanceof InputValidationError) return apiError('VALIDATION_ERROR', 400, false);
    if (error instanceof IdempotencyConflictError) return apiError('IDEMPOTENCY_CONFLICT', 409, false);
    if (error instanceof GameNotActiveError) return apiError('GAME_NOT_ACTIVE', 409, true);
    if (error instanceof WorkerUnavailableError) return apiError('JUDGE_UNAVAILABLE', 503, true);
    return apiError('INTERNAL_ERROR', 500, true);
  }
}
