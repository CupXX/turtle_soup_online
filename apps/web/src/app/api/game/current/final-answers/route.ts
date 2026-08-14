import { readPlayerSession } from '@/server/auth/player-session';
import { getServerEnv } from '@/server/env';
import {
  GameNotActiveError,
  getFinalAnswerReceiptById,
  submitFinalAnswer,
  WorkerUnavailableError,
} from '@/server/game/submit-final-answer';
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
    const answer = normalizeBoundedText(body.answer, 4000, 'answer');
    const idempotencyKey = request.headers.get('Idempotency-Key') ?? '';
    const payloadDigest = computePayloadDigest({ answer }, env.idempotencyHmacSecret);
    const addressHash = hashRateLimitKey(requestAddress(request), env.ipHashSecret);
    const rate = await consumeRateLimit({
      bucket: `final-answer-player:${playerId}:${addressHash}`,
      limit: env.rateLimits.finalAnswerPerPlayerPerFiveMinutes,
      windowSeconds: 5 * 60,
    });
    if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

    const actorScope = `player:${playerId}`;
    const operation = 'FINAL_ANSWER';
    const claim = await claimIdempotency({
      actorScope,
      operation,
      key: idempotencyKey,
      payload: { answer },
    }, { responseStatus: 200 });

    if (claim.kind === 'REPLAY' && claim.resultResourceId) {
      const result = await getFinalAnswerReceiptById(claim.resultResourceId);
      if (!result) return apiError('INTERNAL_ERROR', 500, true);
      return ok(result);
    }

    const result = await submitFinalAnswer({ playerId, answer, idempotencyKey, payloadDigest });
    if (claim.kind === 'NEW') {
      await bindIdempotencyResult({
        actorScope,
        operation,
        key: idempotencyKey,
        resultResourceId: result.submissionId,
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

