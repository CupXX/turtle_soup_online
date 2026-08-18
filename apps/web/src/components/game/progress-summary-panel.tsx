import type { PublicGameProgressSummary, PublicMessage } from '@turtle-soup/contracts';

type SummaryMessage = {
  status: PublicMessage['status'] | 'SENDING';
  verdict: PublicMessage['verdict'];
};

export type ProgressSummaryPanelProps = {
  messages: ReadonlyArray<SummaryMessage>;
  summary: PublicGameProgressSummary | null;
};

function judgedCount(messages: ReadonlyArray<SummaryMessage>): number {
  return messages.filter((message) => message.status === 'JUDGED' && message.verdict !== null).length;
}

function nextBoundaryCountdown(count: number, hasSuccessfulSummary: boolean): string {
  const nextBoundary = (Math.floor(count / 10) + 1) * 10;
  const remaining = Math.max(1, nextBoundary - count);
  return hasSuccessfulSummary
    ? `再完成 ${remaining} 个问题后更新`
    : `再完成 ${remaining} 个问题后整理首次总结`;
}

function FactGroup({ label, facts }: { label: string; facts: string[] }) {
  if (!facts.length) return null;
  return (
    <div className="progress-summary-group">
      <h3>{label}</h3>
      <ul>
        {facts.map((fact) => <li key={fact}>{fact}</li>)}
      </ul>
    </div>
  );
}

export function ProgressSummaryPanel({ messages, summary }: ProgressSummaryPanelProps) {
  const count = judgedCount(messages);
  const hasSuccessfulSummary = Boolean(summary && summary.throughQuestionCount > 0);
  const hasPreviousFacts = hasSuccessfulSummary;
  const target = summary?.targetQuestionCount;
  const status = summary?.generationStatus;
  const currentFacts = summary
    ? Array.from(new Set([...summary.confirmedFacts, ...summary.ruledOutFacts]))
    : [];

  let statusCopy: string;
  if (status === 'ERROR' && !hasPreviousFacts) {
    statusCopy = '当前进度总结暂时不可用';
  } else if (status === 'ERROR') {
    statusCopy = '本轮总结暂时未更新';
  } else if (status === 'PENDING' && hasPreviousFacts && target) {
    statusCopy = `正在更新到第 ${target} 问…`;
  } else if (status === 'PENDING' || (!summary && count >= 10)) {
    statusCopy = '正在整理当前进度…';
  } else if (!hasSuccessfulSummary) {
    statusCopy = '还在探索中';
  } else {
    statusCopy = nextBoundaryCountdown(count, true);
  }

  return (
    <section className="sidebar-card progress-summary-panel" aria-labelledby="progress-summary-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">当前进度</p>
          <h2 id="progress-summary-title">故事线索整理</h2>
        </div>
        {hasSuccessfulSummary ? <span className="progress-label">整理至第 {summary!.throughQuestionCount} 问</span> : null}
      </div>

      <p className="progress-summary-status" aria-live="polite">{statusCopy}</p>

      {!summary || (!hasSuccessfulSummary && status !== 'ERROR' && status !== 'PENDING') ? (
        <p className="muted progress-summary-countdown">{nextBoundaryCountdown(count, false)}</p>
      ) : null}

      {hasSuccessfulSummary ? (
        <div className="progress-summary-facts">
          <FactGroup label="当前事实" facts={currentFacts} />
          <FactGroup label="无关方向" facts={summary!.irrelevantTopics} />
        </div>
      ) : null}
    </section>
  );
}
