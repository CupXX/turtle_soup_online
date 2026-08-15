// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageFeed } from './message-feed';

describe('MessageFeed public events', () => {
  it('shows the verdict legend without the old public-feed headings', () => {
    render(<MessageFeed messages={[]} players={[]} />);

    expect(screen.getByText('✅ 是')).toBeTruthy();
    expect(screen.getByText('❌ 不是')).toBeTruthy();
    expect(screen.getByText('❓ 是也不是')).toBeTruthy();
    expect(screen.getByText('👎 与此无关')).toBeTruthy();
    expect(screen.queryByText('公共问题流')).toBeNull();
    expect(screen.queryByText('大家正在问什么')).toBeNull();
    expect(screen.queryByText('按服务器顺序')).toBeNull();
  });

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

  it('marks only the current player bubble as self-owned and never renders an AI bubble', () => {
    render(<MessageFeed
      currentPlayerId="p1"
      messages={[
        { id: 'm1', gameId: 'g1', playerId: 'p1', sequenceNo: 1, content: '自己的问题', status: 'JUDGED', verdict: 'YES', awardedPoints: 1, createdAt: '', judgedAt: '', updatedAt: '' },
        { id: 'm2', gameId: 'g1', playerId: 'p2', sequenceNo: 2, content: '别人的问题', status: 'PENDING', verdict: null, awardedPoints: 0, createdAt: '', judgedAt: null, updatedAt: '' },
      ]}
      players={[
        { id: 'p1', displayNickname: 'Cups', lifetimeScore: 2, createdAt: '' },
        { id: 'p2', displayNickname: 'Other', lifetimeScore: 1, createdAt: '' },
      ]}
    />);

    expect(screen.getByText('自己的问题').closest('[data-owner="self"]')).toBeTruthy();
    expect(screen.getByText('别人的问题').closest('[data-owner="other"]')).toBeTruthy();
    expect(screen.queryByText(/^AI[:：]/i)).toBeNull();
    expect(document.querySelector('[data-owner="ai"]')).toBeNull();
  });
});
