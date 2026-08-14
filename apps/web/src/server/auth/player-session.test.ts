import { describe, expect, it } from 'vitest';
import {
  PLAYER_SESSION_TTL_SECONDS,
  createPlayerSessionToken,
  readPlayerSession,
  serializePlayerSessionCookie,
} from './player-session.js';

describe('player sessions', () => {
  it('uses a 365-day TTL and writes an HttpOnly lax cookie', () => {
    const secret = 'player-session-secret-that-is-long';
    const now = Math.floor(Date.now() / 1000);
    const cookie = serializePlayerSessionCookie('player-1', {
      playerSessionSecret: secret,
      siteOrigin: 'http://localhost:3000',
    }, now);

    expect(PLAYER_SESSION_TTL_SECONDS).toBe(365 * 24 * 60 * 60);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain(`Max-Age=${PLAYER_SESSION_TTL_SECONDS}`);
    expect(cookie).not.toContain('Secure');
  });

  it('reads only a valid player token from the request cookie', () => {
    const secret = 'player-session-secret-that-is-long';
    const token = createPlayerSessionToken('player-1', secret, Math.floor(Date.now() / 1000));
    const request = new Request('http://localhost/api', {
      headers: { cookie: `other=1; turtle_soup_player=${token}` },
    });

    expect(readPlayerSession(request, secret)).toBe('player-1');
    expect(readPlayerSession(new Request('http://localhost/api'), secret)).toBeNull();
  });
});
