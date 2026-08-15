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

    expect(screen.getByText('Cups 提交了正答：❌ 失败')).toBeTruthy();
    expect(screen.queryByText(/missing|covered|提交内容/i)).toBeNull();
  });

  it('uses the safe success and force-end event copy', () => {
    render(<MessageFeed
      messages={[]}
      players={[{ id: 'p1', displayNickname: 'Cups', lifetimeScore: 2, createdAt: '' }]}
      events={[
        { id: 'e1', gameId: 'g1', sequenceNo: 2, eventType: 'FINAL_ANSWER_SUCCEEDED', playerId: 'p1', awardedPoints: 2, createdAt: '' },
        { id: 'e2', gameId: 'g1', sequenceNo: 3, eventType: 'FORCE_ENDED', playerId: null, awardedPoints: 0, createdAt: '' },
      ]}
    />);

    expect(screen.getByText('Cups 提交了正答：✅ 成功')).toBeTruthy();
    expect(screen.getByText('管理员结束了本局')).toBeTruthy();
  });
});
