// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PublicGameReveal } from '@turtle-soup/contracts';
import { GameRevealPanel } from './game-reveal-panel';

describe('GameRevealPanel', () => {
  it('shows the solution and ordered key points only when a reveal exists', () => {
    const reveal: PublicGameReveal = {
      fullSolution: '他误把影子当成了人。',
      revealedAt: '2026-08-14T12:00:00Z',
      keyPoints: [
        { ordinal: 1, content: '影子是关键点。' },
        { ordinal: 2, content: '误会导致了行动。' },
      ],
    };
    render(<GameRevealPanel reveal={reveal} />);

    expect(screen.getByRole('heading', { name: '汤底' })).toBeTruthy();
    expect(screen.getByText('他误把影子当成了人。')).toBeTruthy();
    expect(screen.getByText('影子是关键点。')).toBeTruthy();
    expect(screen.getByText('误会导致了行动。')).toBeTruthy();
  });
});
