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

  it('marks own and other messages without separating the reaction from the bubble', () => {
    const ownView = render(<MessageRow message={message} nickname="Cups" isOwn />);
    const ownArticle = ownView.getByRole('article');
    expect(ownArticle.getAttribute('data-owner')).toBe('self');
    expect(ownView.getByText('✅').closest('article')).toBe(ownView.getByText(message.content).closest('article'));

    ownView.unmount();
    const otherView = render(<MessageRow message={{ ...message, playerId: 'player-2' }} nickname="Other" />);
    expect(otherView.getByRole('article').getAttribute('data-owner')).toBe('other');
  });

  it('keeps the original reaction visible while a challenge is pending and disables repeat challenges', () => {
    const view = render(<MessageRow message={{ ...message, challengeStatus: 'PENDING' }} nickname="Cups" />);

    expect(view.getByText('✅')).toBeTruthy();
    expect(view.getByText('质疑中')).toBeTruthy();
    expect(view.getByRole('button', { name: '质疑 Cups 的问题' })).toHaveProperty('disabled', true);
    expect(view.getByRole('article').getAttribute('data-challenge-status')).toBe('PENDING');
  });

  it('marks a resolved changed judgment as a successful challenge and prevents another challenge', () => {
    const challengedMessage = {
      ...message,
      challengeStatus: 'RESOLVED',
      challengeOutcome: 'SUCCESS',
    } as PublicMessage;
    const view = render(<MessageRow message={challengedMessage} nickname="Cups" />);

    expect(view.getByText('质疑成功')).toBeTruthy();
    expect(view.getByRole('button', { name: '质疑 Cups 的问题' })).toHaveProperty('disabled', true);
    expect(view.getByRole('article').getAttribute('data-challenge-outcome')).toBe('SUCCESS');
  });

  it('marks an unchanged resolved judgment as upheld and prevents another challenge', () => {
    const challengedMessage = {
      ...message,
      challengeStatus: 'RESOLVED',
      challengeOutcome: 'UPHELD',
    } as PublicMessage;
    const view = render(<MessageRow message={challengedMessage} nickname="Cups" />);

    expect(view.getByText('维持原判')).toBeTruthy();
    expect(view.getByRole('button', { name: '质疑 Cups 的问题' })).toHaveProperty('disabled', true);
    expect(view.getByRole('article').getAttribute('data-challenge-outcome')).toBe('UPHELD');
  });
});
