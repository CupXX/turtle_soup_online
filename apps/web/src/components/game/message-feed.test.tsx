// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageFeed } from './message-feed';

describe('MessageFeed public events', () => {
  it('renders safe final-answer events without any private answer field', () => {
    render(<MessageFeed
      messages={[]}
      players={[{ id: 'p1', displayNickname: 'Cups', lifetimeScore: 2, createdAt: '' }]}
      events={[{ id: 'e1', gameId: 'g1', sequenceNo: 2, eventType: 'FINAL_ANSWER_FAILED', playerId: 'p1', awardedPoints: 0, createdAt: '' }]}
    />);

    expect(screen.getByText('Final answer failed')).toBeTruthy();
    expect(screen.getByText('Cups')).toBeTruthy();
    expect(screen.queryByText(/answer text|missing|covered/i)).toBeNull();
  });
});
