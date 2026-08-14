import { createHash, timingSafeEqual } from 'node:crypto';
import type { ServerEnv } from '@/server/env';
import { signSession, verifySession } from './session-token';

export const ADMIN_SESSION_COOKIE = 'turtle_soup_admin';
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

type AdminSessionConfig = Pick<ServerEnv, 'adminSessionSecret' | 'siteOrigin'>;

export function secretsEqual(candidate: string, expected: string): boolean {
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export function createAdminSessionToken(
  nickname: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  return signSession(
    {
      subject: nickname,
      kind: 'admin',
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + ADMIN_SESSION_TTL_SECONDS,
    },
    secret,
    ADMIN_SESSION_TTL_SECONDS,
  );
}

export function serializeAdminSessionCookie(
  nickname: string,
  config: AdminSessionConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const secure = new URL(config.siteOrigin).protocol === 'https:' ? '; Secure' : '';
  const token = createAdminSessionToken(nickname, config.adminSessionSecret, nowSeconds);
  return `${ADMIN_SESSION_COOKIE}=${token}; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}

export function readAdminSession(request: Request, secret: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) {
    return null;
  }

  const token = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE}=`))
    ?.slice(ADMIN_SESSION_COOKIE.length + 1);
  const payload = token ? verifySession(decodeURIComponent(token), secret) : null;
  return payload?.kind === 'admin' ? payload.subject : null;
}
