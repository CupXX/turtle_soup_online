// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PublicGameProgressSummary, PublicMessage } from '@turtle-soup/contracts';
import { ProgressSummaryPanel } from './progress-summary-panel';

function messages(count: number): PublicMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    gameId: 'game-1',
    playerId: 'player-1',
    sequenceNo: index + 1,
    content: `问题${index + 1}`,
    status: 'JUDGED' as const,
    verdict: 'YES' as const,
    awardedPoints: 0,
    createdAt: '',
    judgedAt: '',
    updatedAt: '',
  }));
}

function summary(overrides: Partial<PublicGameProgressSummary> = {}): PublicGameProgressSummary {
  return {
    gameId: 'game-1',
    throughQuestionCount: 10,
    throughSequenceNo: 10,
    confirmedFacts: ['事实一'],
    ruledOutFacts: ['排除一'],
    irrelevantTopics: ['无关一'],
    generationStatus: 'READY',
    targetQuestionCount: null,
    generatedAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProgressSummaryPanel', () => {
  it('shows the first-summary countdown for zero and seven judged questions', () => {
    const { rerender } = render(<ProgressSummaryPanel messages={messages(0)} summary={null} />);
    expect(screen.getByText('还在探索中')).toBeTruthy();
    expect(screen.getByText('再完成 10 个问题后整理首次总结')).toBeTruthy();

    rerender(<ProgressSummaryPanel messages={messages(7)} summary={null} />);
    expect(screen.getByText('再完成 3 个问题后整理首次总结')).toBeTruthy();
  });

  it('shows pending first-summary copy at ten judged questions', () => {
    render(<ProgressSummaryPanel messages={messages(10)} summary={summary({
      throughQuestionCount: 0,
      throughSequenceNo: 0,
      confirmedFacts: [],
      ruledOutFacts: [],
      irrelevantTopics: [],
      generationStatus: 'PENDING',
      targetQuestionCount: 10,
      generatedAt: null,
    })} />);

    expect(screen.getByText('正在整理当前进度…')).toBeTruthy();
  });

  it('renders READY categories and updates countdown from current judged messages', () => {
    render(<ProgressSummaryPanel messages={messages(17)} summary={summary()} />);

    expect(screen.getByText('整理至第 10 问')).toBeTruthy();
    expect(screen.getByText('事实一')).toBeTruthy();
    expect(screen.getByText('排除一')).toBeTruthy();
    expect(screen.getByText('无关一')).toBeTruthy();
    expect(screen.getByText('再完成 3 个问题后更新')).toBeTruthy();
  });

  it('keeps old facts while a newer target is pending or failed', () => {
    const { rerender } = render(<ProgressSummaryPanel messages={messages(37)} summary={summary({
      throughQuestionCount: 30,
      targetQuestionCount: 40,
      generationStatus: 'PENDING',
    })} />);
    expect(screen.getByText('事实一')).toBeTruthy();
    expect(screen.getByText('正在更新到第 40 问…')).toBeTruthy();

    rerender(<ProgressSummaryPanel messages={messages(37)} summary={summary({
      throughQuestionCount: 30,
      targetQuestionCount: 40,
      generationStatus: 'ERROR',
    })} />);
    expect(screen.getByText('事实一')).toBeTruthy();
    expect(screen.getByText('本轮总结暂时未更新')).toBeTruthy();
  });

  it('uses safe failure copy and omits empty categories without hidden progress data', () => {
    render(<ProgressSummaryPanel messages={messages(10)} summary={summary({
      throughQuestionCount: 0,
      throughSequenceNo: 0,
      confirmedFacts: [],
      ruledOutFacts: [],
      irrelevantTopics: [],
      generationStatus: 'ERROR',
      targetQuestionCount: 10,
      generatedAt: null,
    })} />);

    expect(screen.getByText('当前进度总结暂时不可用')).toBeTruthy();
    expect(screen.queryByText(/关键点已发现/)).toBeNull();
    expect(screen.queryByText('已确认')).toBeNull();
  });
});
