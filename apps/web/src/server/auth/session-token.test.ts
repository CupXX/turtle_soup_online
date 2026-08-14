import { describe, expect, it, vi } from 'vitest';
import { signSession, verifySession, type SessionPayload } from './session-token.js';

const secret = 'session-secret-that-is-long-enough';
const baseTime = Math.floor(Date.now() / 1000);

function payload(expiresAt = baseTime + 600): SessionPayload {
  return {
    subject: 'player-1',
    kind: 'player',
    issuedAt: baseTime,
    expiresAt,
  };
}

describe('signed session tokens', () => {
  it('round-trips a signed payload', () => {
    const token = signSession(payload(), secret, 600);

    expect(verifySession(token, secret)).toEqual(payload());
  });

  it('rejects tampering, wrong secrets, and expired payloads', () => {
    const token = signSession(payload(), secret, 600);

    expect(verifySession(`${token}tampered`, secret)).toBeNull();
    expect(verifySession(token, 'another-secret-that-is-long-enough')).toBeNull();

    vi.setSystemTime(new Date((baseTime + 601) * 1000));
    expect(verifySession(token, secret)).toBeNull();
    vi.useRealTimers();
  });

  it('does not allow a token lifetime beyond the supplied TTL', () => {
    expect(() => signSession(payload(baseTime + 1_000), secret, 600)).toThrow(/ttl/i);
  });
});
