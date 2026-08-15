import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameSnapshot, PublicMessage } from '@turtle-soup/contracts';
import {
  adminLogin,
  createGame,
  createPlayerSession,
  fetchAdminStatus,
  fetchCurrentGame,
  joinCurrentGame,
  postFinalAnswer,
  postQuestion,
  replacePreparation,
  retryExtraction,
} from './game-api.js';

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestInit(): RequestInit {
  return fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
}

describe('game API client', () => {
  it('creates a player session with a generated idempotency key and same-origin credentials', async () => {
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(response({ playerId: 'player-1', displayNickname: 'Cups' })));

    await expect(createPlayerSession(' Cups ')).resolves.toEqual({ playerId: 'player-1', displayNickname: 'Cups' });

    expect(fetchMock).toHaveBeenCalledWith('/api/player-session', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    const init = requestInit();
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(init.headers).get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toEqual({ nickname: ' Cups ' });
  });

  it('keeps the idempotency key UUID-shaped when randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', { randomUUID: undefined });
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(response({ gameId: 'game-1' })));

    await joinCurrentGame();

    expect(new Headers(requestInit().headers).get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('posts a question and carries the generated receipt key', async () => {
    const message = { id: 'message-1', status: 'PENDING', content: 'question' } as unknown as PublicMessage;
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(response(message)));

    await expect(postQuestion('question')).resolves.toEqual(message);

    expect(fetchMock).toHaveBeenCalledWith('/api/game/current/messages', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    expect(new Headers(requestInit().headers).get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('posts a private final answer with a generated receipt key', async () => {
    const receipt = { submissionId: 'submission-1', gameId: 'game-1', playerId: 'player-1', sequenceNo: 4, status: 'PENDING' as const };
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(response(receipt)));

    await expect(postFinalAnswer('private answer')).resolves.toEqual(receipt);

    expect(fetchMock).toHaveBeenCalledWith('/api/game/current/final-answers', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    expect(new Headers(requestInit().headers).get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(requestInit().body))).toEqual({ answer: 'private answer' });
  });

  it('reads snapshots and routes admin lifecycle operations through existing handlers', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const snapshot = { game: { id: 'game-1' } } as unknown as PublicGameSnapshot;
    fetchMock
      .mockResolvedValueOnce(response(snapshot))
      .mockResolvedValueOnce(response({ nickname: 'host' }))
      .mockResolvedValueOnce(response({ gameId: 'game-1', status: 'WAITING' }))
      .mockResolvedValueOnce(response({ status: 'WAITING' }))
      .mockResolvedValueOnce(response({ gameId: 'game-1', gameStatus: 'WAITING', extractionStatus: 'PENDING', actionStatus: null, errorCode: null, workerHealthy: true, keyPoints: [] }))
      .mockResolvedValueOnce(response({ status: 'RETRY' }))
      .mockResolvedValueOnce(response({ gameId: 'game-1' }));

    await expect(fetchCurrentGame()).resolves.toEqual(snapshot);
    await expect(adminLogin({ nickname: 'host', secret: 'secret' })).resolves.toEqual({ nickname: 'host' });
    await expect(createGame({ puzzleSurface: 'surface', fullSolution: 'solution' })).resolves.toMatchObject({ gameId: 'game-1' });
    await expect(replacePreparation({ puzzleSurface: 'surface-2', fullSolution: 'solution-2' })).resolves.toEqual({ status: 'WAITING' });
    await expect(fetchAdminStatus()).resolves.toMatchObject({ extractionStatus: 'PENDING' });
    await expect(retryExtraction()).resolves.toEqual({ status: 'RETRY' });
    await expect(joinCurrentGame()).resolves.toEqual({ gameId: 'game-1' });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/game/current',
      '/api/admin/session',
      '/api/admin/games',
      '/api/admin/games/current/preparation',
      '/api/admin/status',
      '/api/admin/games/current/retry-extraction',
      '/api/game/current/join',
    ]);
  });
});
