type ExtractionStatusValue = 'IDLE' | 'RUNNING' | 'READY' | 'FAILED' | 'BLOCKED';

type ExtractionStatusProps = {
  status: ExtractionStatusValue;
  message?: string;
  onRetry?: () => void;
};

const labels: Record<ExtractionStatusValue, string> = {
  IDLE: '尚未开始',
  RUNNING: '正在提取关键点',
  READY: '关键点已准备好',
  FAILED: '关键点提取失败',
  BLOCKED: '判定队列已阻塞',
};

export function ExtractionStatus({ status, message, onRetry }: ExtractionStatusProps) {
  const retryable = status === 'FAILED' || status === 'BLOCKED';
  return (
    <section className="admin-card status-card" aria-labelledby="extraction-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">后台状态</p>
          <h2 id="extraction-title">关键点提取</h2>
        </div>
        <span className={`status-pill status-${status.toLowerCase()}`}>{labels[status]}</span>
      </div>
      <p className="muted">{message ?? '这里只显示状态和安全错误码，不展示汤底或隐藏关键点。'}</p>
      {retryable && onRetry ? <button className="quiet-button" type="button" onClick={onRetry}>重试关键点提取</button> : null}
    </section>
  );
}

export type { ExtractionStatusValue };
