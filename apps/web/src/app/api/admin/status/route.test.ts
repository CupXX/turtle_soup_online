import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminSessionToken } from '@/server/auth/admin-session';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getAdminStatus: vi.fn(),
}));

vi.mock('@/server/db/client', () => ({ getDb: mocks.getDb }));
vi.mock('@/server/game/admin-lifecycle', () => ({ getAdminStatus: mocks.getAdminStatus }));

import { GET } from './route.js';

const originalEnv = { ...process.env };
const adminSecret = 'admin-session-secret';

afterEach(() => {
  process.env = { ...originalEnv };
  mocks.getDb.mockReset();
  mocks.getAdminStatus.mockReset();
});

function validEnv() {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    GAME_WEB_DATABASE_URL: 'postgresql://user:password@example.test:5432/game',
    SITE_ORIGIN: 'http://localhost:3000',
    PLAYER_SESSION_SECRET: 'player-session-secret',
    ADMIN_SESSION_SECRET: adminSecret,
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

function adminCookie() {
  return `turtle_soup_admin=${createAdminSessionToken('主持人', adminSecret)}`;
}

describe('GET /api/admin/status', () => {
  it('returns only safe state and disables caching for an authenticated admin', async () => {
    validEnv();
    mocks.getDb.mockReturnValue('sql');
    mocks.getAdminStatus.mockResolvedValue({ gameId: 'game-1', gameStatus: 'WAITING', extractionStatus: 'PENDING', actionStatus: null, errorCode: null, workerHealthy: false, keyPoints: [] });

    const response = await GET(new Request('http://localhost:3000/api/admin/status', { headers: { cookie: adminCookie() } }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ data: { gameId: 'game-1', gameStatus: 'WAITING', extractionStatus: 'PENDING', actionStatus: null, errorCode: null, workerHealthy: false, keyPoints: [] } });
  });
});
