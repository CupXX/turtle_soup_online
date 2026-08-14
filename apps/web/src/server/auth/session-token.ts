import { createHmac, timingSafeEqual } from 'node:crypto';

export type SessionPayload = {
  subject: string;
  kind: 'player' | 'admin';
  issuedAt: number;
  expiresAt: number;
};

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signatureFor(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function signSession(payload: SessionPayload, secret: string, ttlSeconds: number): string {
  if (!secret || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('Invalid session signing configuration');
  }
  if (
    !payload.subject ||
    !Number.isInteger(payload.issuedAt) ||
    !Number.isInteger(payload.expiresAt) ||
    payload.expiresAt <= payload.issuedAt ||
    payload.expiresAt - payload.issuedAt > ttlSeconds
  ) {
    throw new Error('Session payload exceeds ttl');
  }

  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${signatureFor(encodedPayload, secret)}`;
}

function isPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Partial<SessionPayload>;
  const issuedAt = payload.issuedAt;
  const expiresAt = payload.expiresAt;
  return (
    typeof payload.subject === 'string' &&
    payload.subject.length > 0 &&
    (payload.kind === 'player' || payload.kind === 'admin') &&
    Number.isInteger(issuedAt) &&
    Number.isInteger(expiresAt) &&
    (expiresAt as number) > (issuedAt as number)
  );
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  if (!token || !secret) {
    return null;
  }

  const [encodedPayload, encodedSignature, ...extra] = token.split('.');
  if (!encodedPayload || !encodedSignature || extra.length > 0) {
    return null;
  }

  try {
    const actual = Buffer.from(encodedSignature, 'base64url');
    const expected = Buffer.from(signatureFor(encodedPayload, secret), 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as unknown;
    if (!isPayload(payload)) {
      return null;
    }
    if (Math.floor(Date.now() / 1000) >= payload.expiresAt) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
