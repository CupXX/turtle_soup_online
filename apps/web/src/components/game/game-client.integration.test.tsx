// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameSnapshot, PublicMessage } from '@turtle-soup/contracts';
import { GameClient } from './game-client';

const activeSnapshot = {
  game: {
    id: 'game-1', status: 'ACTIVE', puzzleSurface: 'A signal was found by the shore.',
    keyPointTotal: 3, discoveredKeyPointCount: 1, totalQuestionCount: 2,
    endReason: null, winnerPlayerId: null, createdAt: '', activatedAt: '', endedAt: null, updatedAt: '',
  },
  players: [{ id: 'p1', displayNickname: 'Cups', lifetimeScore: 2, createdAt: '' }],
  messages: [], events: [], stats: [], reveal: null,
  progressSummary: null,
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

  it('uses 当前汤面, verdict legend, and 正答 as the public labels', () => {
    render(<GameClient initialSnapshot={activeSnapshot} currentPlayerId="p1" />);

    expect(screen.getByRole('heading', { name: '当前汤面' })).toBeTruthy();
    expect(screen.getByText('✅ 是')).toBeTruthy();
    expect(screen.getByText('❌ 不是')).toBeTruthy();
    expect(screen.getByText('❓ 是也不是')).toBeTruthy();
    expect(screen.getByText('👎 与此无关')).toBeTruthy();
    expect(screen.queryByText('共享汤面')).toBeNull();
    expect(screen.queryByText('大家正在问什么')).toBeNull();
    expect(screen.queryByText('按服务器顺序')).toBeNull();
    expect(screen.getByText(/关键点已发现/)).toBeTruthy();
    expect(screen.getByText('当前进度')).toBeTruthy();
    expect(screen.queryByText('即将加入')).toBeNull();
    expect(screen.queryByRole('link', { name: '管理入口' })).toBeNull();
    expect(screen.getByText('在线多人AI海龟汤游戏')).toBeTruthy();
    expect(screen.getByRole('button', { name: '提交正答' })).toBeTruthy();
  });

  it('shows the sender bubble before an unresolved submit is judged', async () => {
    const user = userEvent.setup();
    let resolveSubmit!: (message: PublicMessage) => void;
    const pendingSubmit = new Promise<PublicMessage>((resolve) => { resolveSubmit = resolve; });
    render(<GameClient
      initialSnapshot={activeSnapshot}
      currentPlayerId="p1"
      onMessageSubmit={() => pendingSubmit}
    />);

    await user.type(screen.getByLabelText('提出问题'), '是不是有蚊子？');
    await user.click(screen.getByRole('button', { name: '发送问题' }));

    const sendingArticle = screen.getByText('是不是有蚊子？').closest('article');
    expect(sendingArticle?.getAttribute('data-owner')).toBe('self');
    expect(sendingArticle?.getAttribute('data-status')).toBe('SENDING');
    expect(screen.getByText('发送中')).toBeTruthy();

    resolveSubmit({
      id: 'message-1', gameId: 'game-1', playerId: 'p1', sequenceNo: 3, content: '是不是有蚊子？',
      status: 'PENDING', verdict: null, awardedPoints: 0, createdAt: '', judgedAt: null, updatedAt: '',
    });
    await waitFor(() => expect(screen.getByText('是不是有蚊子？').closest('article')?.getAttribute('data-status')).toBe('PENDING'));
    expect(screen.getByText('判定中')).toBeTruthy();
  });

  it('submits a challenge without creating an AI message and keeps the original reaction attached', async () => {
    const user = userEvent.setup();
    const onChallengeSubmit = vi.fn().mockResolvedValue({ challengeId: 'challenge-1', messageId: 'message-1', status: 'PENDING' });
    const snapshot = {
      ...activeSnapshot,
      messages: [{
        id: 'message-1', gameId: 'game-1', playerId: 'p1', sequenceNo: 1, content: '是不是有蚊子？',
        status: 'JUDGED', verdict: 'YES', awardedPoints: 1, challengeStatus: 'NONE', createdAt: '', judgedAt: '', updatedAt: '',
      }],
    } as PublicGameSnapshot;

    render(<GameClient initialSnapshot={snapshot} currentPlayerId="p1" onChallengeSubmit={onChallengeSubmit} />);
    await user.click(screen.getByRole('button', { name: '质疑 Cups 的问题' }));

    await waitFor(() => expect(onChallengeSubmit).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-1' })));
    const messageArticle = screen.getByText('是不是有蚊子？').closest('article');
    expect(messageArticle?.getAttribute('data-challenge-status')).toBe('PENDING');
    expect(screen.getByText('✅')).toBeTruthy();
    expect(screen.queryByText(/^AI[:：]/i)).toBeNull();
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
    await waitFor(() => expect(screen.getByText('当前进度')).toBeTruthy());
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/game/current/join', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/game/current', expect.objectContaining({ cache: 'no-store' }));
  });
});
