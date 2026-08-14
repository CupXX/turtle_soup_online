type ExtractionStatusValue = 'IDLE' | 'RUNNING' | 'READY' | 'FAILED' | 'BLOCKED';

type ExtractionStatusProps = {
  status: ExtractionStatusValue;
  message?: string;
  onRetry?: () => void;
};

const labels: Record<ExtractionStatusValue, string> = {
  IDLE: '尚未开始',
  RUNNING: '正在提取线索',
  READY: '线索已准备好',
  FAILED: '线索提取失败',
  BLOCKED: '判定队列已阻塞',
};

export function ExtractionStatus({ status, message, onRetry }: ExtractionStatusProps) {
  const retryable = status === 'FAILED' || status === 'BLOCKED';
  return (
    <section className="admin-card status-card" aria-labelledby="extraction-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">后台状态</p>
          <h2 id="extraction-title">线索提取</h2>
        </div>
        <span className={`status-pill status-${status.toLowerCase()}`}>{labels[status]}</span>
      </div>
      <p className="muted">{message ?? '这里只显示状态和安全错误码，不展示完整答案或隐藏线索。'}</p>
      {retryable && onRetry ? <button className="quiet-button" type="button" onClick={onRetry}>重试线索提取</button> : null}
    </section>
  );
}

export type { ExtractionStatusValue };
