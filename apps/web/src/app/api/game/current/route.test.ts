import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameSnapshot } from '@turtle-soup/contracts';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getCurrentSnapshot: vi.fn(),
}));

vi.mock('@/server/db/client', () => ({ getDb: mocks.getDb }));
vi.mock('@/server/game/get-current-snapshot', () => ({ getCurrentSnapshot: mocks.getCurrentSnapshot }));

import { GET } from './route.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  mocks.getDb.mockReset();
  mocks.getCurrentSnapshot.mockReset();
});

function validEnv() {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    GAME_WEB_DATABASE_URL: 'postgresql://user:password@example.test:5432/game',
    SITE_ORIGIN: 'http://localhost:3000',
    PLAYER_SESSION_SECRET: 'player-session-secret',
    ADMIN_SESSION_SECRET: 'admin-session-secret',
    ADMIN_SECRET: 'admin-login-secret',
    IDEMPOTENCY_HMAC_SECRET: 'idempotency-hmac-secret',
    IP_HASH_SECRET: 'ip-hash-secret-01',
    RATE_LIMIT_PLAYER_JOIN_PER_MINUTE: '10',
    RATE_LIMIT_MESSAGE_PER_PLAYER_PER_MINUTE: '12',
    RATE_LIMIT_MESSAGE_PER_IP_PER_MINUTE: '30',
    RATE_LIMIT_FINAL_ANSWER_PER_PLAYER_PER_5_MINUTES: '3',
    RATE_LIMIT_ADMIN_LOGIN_PER_IP_PER_15_MINUTES: '5',
    RATE_LIMIT_ADMIN_WRITE_PER_SESSION_PER_MINUTE: '10',
  };
}

describe('GET /api/game/current', () => {
  it('returns a no-store public snapshot and never exposes private fields', async () => {
    validEnv();
    const snapshot = { game: { id: 'game-1' }, players: [], messages: [], events: [], stats: [], reveal: null } as unknown as PublicGameSnapshot;
    mocks.getDb.mockReturnValue('sql');
    mocks.getCurrentSnapshot.mockResolvedValue(snapshot);

    const response = await GET(new Request('http://localhost:3000/api/game/current'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ data: snapshot });
    expect(mocks.getCurrentSnapshot).toHaveBeenCalledWith('sql', undefined);
  });
});
