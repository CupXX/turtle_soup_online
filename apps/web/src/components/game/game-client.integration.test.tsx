// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

describe('GameClient', () => {
  it('renders the active dashboard and opens the private final-answer modal', async () => {
    const user = userEvent.setup();
    render(<GameClient initialSnapshot={activeSnapshot} />);

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
});
