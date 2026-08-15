// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameSnapshot } from '@turtle-soup/contracts';
import { GameClient } from './game-client';

const activeSnapshot = {
  game: {
    id: 'game-1', status: 'ACTIVE', puzzleSurface: 'A signal was found by the shore.',
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

    expect(screen.getByText('A signal was found by the shore.')).toBeTruthy();
    await user.click(screen.getAllByRole('button')[1]);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps message submission local until an API adapter is provided', async () => {
    const user = userEvent.setup();
    const onMessageSubmit = vi.fn();
    render(<GameClient initialSnapshot={activeSnapshot} onMessageSubmit={onMessageSubmit} />);

    await user.type(screen.getAllByRole('textbox')[0], 'question');
    await user.click(screen.getAllByRole('button')[0]);
    expect(onMessageSubmit).toHaveBeenCalledWith('question');
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
    await user.type(screen.getAllByRole('textbox')[0], 'question');
    await user.click(screen.getAllByRole('button')[0]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/game/current/messages', expect.objectContaining({ method: 'POST' })));
  });

  it('uses the private final-answer route and never renders the submitted text publicly', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { submissionId: 'submission-1', gameId: 'game-1', playerId: 'p1', sequenceNo: 1, status: 'PENDING' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<GameClient initialSnapshot={activeSnapshot} currentPlayerId="p1" />);
    await user.click(screen.getAllByRole('button')[1]);
    await user.type(screen.getAllByRole('textbox').at(-1)!, 'private final answer');
    await user.click(screen.getAllByRole('button').at(-1)!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/game/current/final-answers', expect.objectContaining({ method: 'POST' })));
    expect(screen.queryByText('private final answer')).toBeNull();
  });

  it('uses 汤面 and 正答 as the public labels', () => {
    render(<GameClient initialSnapshot={activeSnapshot} currentPlayerId="p1" />);

    expect(screen.getByRole('heading', { name: '汤面' })).toBeTruthy();
    expect(screen.getByText(/关键点已发现/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '提交正答' })).toBeTruthy();
  });

  it('disables both inputs and shows the reveal after the game has ended', () => {
    const endedSnapshot = {
      ...activeSnapshot,
      game: { ...activeSnapshot.game, status: 'ENDED', endReason: 'FORCE_ENDED', endedAt: '2026-08-15T01:00:00.000Z' },
      reveal: { fullSolution: 'revealed solution', revealedAt: '2026-08-15T01:00:00.000Z', keyPoints: [{ ordinal: 1, content: 'revealed point' }] },
    } as PublicGameSnapshot;

    render(<GameClient initialSnapshot={endedSnapshot} currentPlayerId="p1" />);

    expect(screen.getByText('revealed solution')).toBeTruthy();
    expect(screen.getAllByRole('button')[1]).toHaveProperty('disabled', true);
    expect(screen.getAllByRole('button')[0]).toHaveProperty('disabled', true);
  });

  it('creates a player session, joins the current game, and refreshes after the nickname gate', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { playerId: 'p1', displayNickname: 'Cups' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { gameId: 'game-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: activeSnapshot }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<GameClient initialSnapshot={activeSnapshot} requireNickname />);
    await user.type(screen.getByRole('textbox'), 'Cups');
    await user.click(screen.getAllByRole('button')[0]);

    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/player-session', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.getByText('Cups')).toBeTruthy());
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/game/current/join', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/game/current', expect.objectContaining({ cache: 'no-store' }));
  });
});
