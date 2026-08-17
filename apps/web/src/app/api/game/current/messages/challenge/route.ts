import { readPlayerSession } from '@/server/auth/player-session';
import { getServerEnv } from '@/server/env';
import {
  ChallengeAlreadySubmittedError,
  ChallengeInProgressError,
  ChallengeMessageNotFoundError,
  ChallengeJudgmentUnavailableError,
  getChallengeById,
  submitChallenge,
} from '@/server/game/submit-challenge';
import { apiError, ok } from '@/server/http/responses';
import {
  bindIdempotencyResult,
  claimIdempotency,
  computePayloadDigest,
  IdempotencyConflictError,
} from '@/server/security/idempotency';
import { InputValidationError, readJsonObject, requireUuid } from '@/server/security/input';
import { SameOriginError, assertSameOrigin } from '@/server/security/origin';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const env = getServerEnv();
    const playerId = readPlayerSession(request, env.playerSessionSecret);
    if (!playerId) return apiError('PLAYER_SESSION_REQUIRED', 401, false);

    const body = await readJsonObject(request);
    const messageId = requireUuid(body.messageId, 'messageId');
    const idempotencyKey = request.headers.get('Idempotency-Key') ?? '';
    const payloadDigest = computePayloadDigest({ messageId }, env.idempotencyHmacSecret);
    const actorScope = `player:${playerId}`;
    const operation = 'MESSAGE_CHALLENGE';
    const claim = await claimIdempotency({
      actorScope,
      operation,
      key: idempotencyKey,
      payload: { messageId },
    }, { responseStatus: 200 });

    if (claim.kind === 'REPLAY' && claim.resultResourceId) {
      const result = await getChallengeById(claim.resultResourceId);
      if (!result) return apiError('INTERNAL_ERROR', 500, true);
      return ok(result);
    }

    const result = await submitChallenge({ playerId, messageId, idempotencyKey, payloadDigest });
    if (claim.kind === 'NEW') {
      await bindIdempotencyResult({
        actorScope,
        operation,
        key: idempotencyKey,
        resultResourceId: result.challengeId,
        responseStatus: 200,
      });
    }
    return ok(result);
  } catch (error) {
    if (error instanceof SameOriginError) return apiError('VALIDATION_ERROR', 403, false);
    if (error instanceof InputValidationError) return apiError('VALIDATION_ERROR', 400, false);
    if (error instanceof IdempotencyConflictError) return apiError('IDEMPOTENCY_CONFLICT', 409, false);
    if (error instanceof ChallengeInProgressError) return apiError('CHALLENGE_IN_PROGRESS', 409, true);
    if (error instanceof ChallengeAlreadySubmittedError) return apiError('CHALLENGE_ALREADY_SUBMITTED', 409, false);
    if (error instanceof ChallengeMessageNotFoundError) return apiError('MESSAGE_NOT_CHALLENGEABLE', 409, false);
    if (error instanceof ChallengeJudgmentUnavailableError) return apiError('CHALLENGE_UNAVAILABLE', 503, true);
    return apiError('INTERNAL_ERROR', 500, true);
  }
}
