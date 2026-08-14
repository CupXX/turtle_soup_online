import { serializeAdminSessionCookie, secretsEqual, ADMIN_SESSION_COOKIE } from '@/server/auth/admin-session';
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
    if (typeof body.secret !== 'string' || !body.secret) {
      throw new InputValidationError('secret is required');
    }

    const env = getServerEnv();
    const addressHash = hashRateLimitKey(requestAddress(request), env.ipHashSecret);
    const rate = await consumeRateLimit({
      bucket: `admin-login:${addressHash}`,
      limit: env.rateLimits.adminLoginPerIpPerFifteenMinutes,
      windowSeconds: 15 * 60,
    });
    if (!rate.allowed) {
      return rateLimited(rate.retryAfterSeconds);
    }

    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) {
      throw new InputValidationError('Idempotency-Key is required');
    }
    await claimIdempotency({
      actorScope: `admin-ip:${addressHash}`,
      operation: 'ADMIN_LOGIN',
      key: idempotencyKey,
      payload: { nicknameKey: nickname.key },
    });

    if (!secretsEqual(body.secret, env.adminSecret)) {
      return apiError('ADMIN_SESSION_REQUIRED', 401, false);
    }

    const response = ok({ nickname: nickname.display });
    response.headers.set('set-cookie', serializeAdminSessionCookie(nickname.display, env));
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

export async function DELETE(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const env = getServerEnv();
    const secure = new URL(env.siteOrigin).protocol === 'https:' ? '; Secure' : '';
    const response = ok({ cleared: true });
    response.headers.set('set-cookie', `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`);
    return response;
  } catch (error) {
    return error instanceof SameOriginError
      ? apiError('VALIDATION_ERROR', 403, false)
      : apiError('INTERNAL_ERROR', 500, true);
  }
}
