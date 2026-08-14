// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PublicMessage } from '@turtle-soup/contracts';
import { MessageRow } from './message-row';

const message: PublicMessage = {
  id: 'message-1',
  gameId: 'game-1',
  playerId: 'player-1',
  sequenceNo: 4,
  content: '他是不是因为误会而离开？',
  status: 'JUDGED',
  verdict: 'YES',
  awardedPoints: 1,
  createdAt: '2026-08-14T12:00:00.000Z',
  judgedAt: '2026-08-14T12:00:01.000Z',
  updatedAt: '2026-08-14T12:00:01.000Z',
};

describe('MessageRow', () => {
  it('keeps reaction and points beside the original message', () => {
    const onChallenge = vi.fn();
    render(<MessageRow message={message} nickname="Cups" onChallenge={onChallenge} />);

    expect(screen.getByText('他是不是因为误会而离开？')).toBeTruthy();
    expect(screen.getByText('✅')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByRole('button', { name: '质疑 Cups 的问题' })).toBeTruthy();
  });
});
