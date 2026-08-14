import { describe, expect, it } from 'vitest';
import {
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  secretsEqual,
  serializeAdminSessionCookie,
} from './admin-session.js';

describe('admin sessions', () => {
  it('compares secrets without a length-based early return', () => {
    expect(secretsEqual('correct-secret', 'correct-secret')).toBe(true);
    expect(secretsEqual('correct-secret', 'wrong-secret')).toBe(false);
    expect(secretsEqual('short', 'correct-secret')).toBe(false);
  });

  it('uses an eight-hour strict cookie and never stores the secret in it', () => {
    const secret = 'admin-secret-that-is-long-enough';
    const cookie = serializeAdminSessionCookie('Cups', {
      adminSessionSecret: secret,
      siteOrigin: 'https://game.example',
    }, 1_700_000_000);

    expect(ADMIN_SESSION_TTL_SECONDS).toBe(8 * 60 * 60);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(cookie).not.toContain(secret);
    expect(createAdminSessionToken('Cups', secret, 1_700_000_000)).not.toContain(secret);
  });
});
