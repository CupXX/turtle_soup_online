// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameSnapshot } from '@turtle-soup/contracts';
import { GameClient } from './game-client';

const activeSnapshot = {
  game: {
    id: 'game-1', status: 'ACTIVE', puzzleSurface: '有人在海边捡到了一把伞。',
    keyPointTotal: 3, discoveredKeyPointCount: 1, totalQuestionCount: 2,
    endReason: null, winnerPlayerId: null, createdAt: '', activatedAt: '', endedAt: null, updatedAt: '',
  },
  players: [{ id: 'p1', displayNickname: 'Cups', lifetimeScore: 2, createdAt: '' }],
  messages: [], events: [], stats: [], reveal: null,
} as PublicGameSnapshot;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GameClient', () => {
  it('renders the active dashboard and opens the private final-answer modal', async () => {
    const user = userEvent.setup();
    render(<GameClient initialSnapshot={activeSnapshot} enableFinalAnswer />);

    expect(screen.getByText('有人在海边捡到了一把伞。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '提交最终答案' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps message submission local until an API adapter is provided', async () => {
    const user = userEvent.setup();
    const onMessageSubmit = vi.fn();
    render(<GameClient initialSnapshot={activeSnapshot} onMessageSubmit={onMessageSubmit} />);

    await user.type(screen.getByLabelText('提出问题'), '这把伞重要吗？');
    await user.click(screen.getByRole('button', { name: '发送问题' }));
    expect(onMessageSubmit).toHaveBeenCalledWith('这把伞重要吗？');
  });

  it('uses the live message route when no adapter is injected', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        id: 'message-1', gameId: 'game-1', playerId: 'p1', sequenceNo: 1, content: 'question',
        status: 'PENDING', verdict: null, awardedPoints: 0, createdAt: '', judgedAt: null, updatedAt: '',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<GameClient initialSnapshot={activeSnapshot} currentPlayerId="p1" />);
    await user.type(screen.getByLabelText('提出问题'), 'question');
    await user.click(screen.getByRole('button', { name: '发送问题' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/game/current/messages', expect.objectContaining({ method: 'POST' })));
  });

  it('creates a player session, joins the current game, and refreshes after the nickname gate', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { playerId: 'p1', displayNickname: 'Cups' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { gameId: 'game-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSnapshot }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<GameClient initialSnapshot={activeSnapshot} requireNickname />);
    await user.type(screen.getByLabelText('昵称'), 'Cups');
    await user.click(screen.getByRole('button', { name: '进入游戏' }));

    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/player-session', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.getByText('Cups')).toBeTruthy());
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/game/current/join', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/game/current', expect.objectContaining({ cache: 'no-store' }));
  });
});
