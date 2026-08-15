// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PublicPlayerStats } from '@turtle-soup/contracts';
import { PlayerStatsPanel } from './player-stats-panel';

const stats: PublicPlayerStats[] = [
  {
    gameId: 'game-1', playerId: 'p2', displayNickname: 'Alice', lifetimeScore: 1,
    questionCount: 2, yesCount: 1, hitRate: 0.5, updatedAt: '2026-08-14T12:00:00Z',
  },
  {
    gameId: 'game-1', playerId: 'p1', displayNickname: 'Cups', lifetimeScore: 1,
    questionCount: 0, yesCount: 0, hitRate: null, updatedAt: '2026-08-14T12:00:00Z',
  },
];

describe('PlayerStatsPanel', () => {
  it('sorts by lifetime score, YES count, then nickname and shows zero as a dash', () => {
    render(<PlayerStatsPanel stats={stats} />);

    const rows = screen.getAllByRole('row');
    expect(rows[1].textContent).toContain('Alice');
    expect(rows[2].textContent).toContain('Cups');
    expect(rows[2].textContent).toContain('—');
  });

  it('shows the current-game question count between score and hit rate', () => {
    render(<PlayerStatsPanel stats={stats} />);

    expect(screen.getByRole('columnheader', { name: '本局提问数' })).toBeTruthy();
    const alice = screen.getAllByRole('row')[1];
    expect(alice.textContent).toContain('1');
    expect(alice.textContent).toContain('2');
    expect(alice.textContent).toContain('50%');
  });
});
