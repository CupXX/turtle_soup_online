import type { PublicMessage } from '@turtle-soup/contracts';
import { reactionForVerdict } from '@turtle-soup/game-core/browser';

export type GameMessage = Omit<PublicMessage, 'status'> & { status: PublicMessage['status'] | 'SENDING' };

type MessageRowProps = {
  message: GameMessage;
  nickname: string;
  isOwn?: boolean;
  onChallenge?: (message: GameMessage) => void;
};

function statusText(message: GameMessage): string {
  if (message.status === 'SENDING') return '发送中';
  if (message.status === 'PENDING') return '判定中';
  if (message.status === 'ERROR') return '等待重试';
  if (message.status === 'CANCELLED') return '已取消';
  return message.verdict ? reactionForVerdict(message.verdict) : '—';
}

export function MessageRow({ message, nickname, isOwn = false, onChallenge }: MessageRowProps) {
  const judged = message.status === 'JUDGED' && message.verdict;
  const challengeStatus = message.challengeStatus ?? 'NONE';
  const canChallenge = Boolean(judged && challengeStatus === 'NONE');
  const challengeLabel = challengeStatus === 'PENDING'
    ? '质疑中'
    : challengeStatus === 'RESOLVED'
      ? message.challengeOutcome === 'SUCCESS'
        ? '质疑成功'
        : message.challengeOutcome === 'UPHELD'
          ? '维持原判'
          : '已质疑'
      : challengeStatus === 'FAILED'
        ? '质疑失败'
        : '质疑';
  return (
    <article
      className="message-row"
      data-owner={isOwn ? 'self' : 'other'}
      data-status={message.status}
      data-challenge-status={challengeStatus}
      data-challenge-outcome={message.challengeOutcome ?? undefined}
    >
      <div className="message-meta">
        <span className="message-sequence">#{message.sequenceNo}</span>
        <strong>{nickname}</strong>
      </div>
      <p className="message-body">{message.content}</p>
      <div
        className="message-result"
        aria-label={judged
          ? `判定 ${message.verdict}${message.awardedPoints > 0 ? `，触发 ${message.awardedPoints} 个关键点` : ''}`
          : statusText(message)}
      >
        <span className="reaction-line">
          <span className="reaction" aria-hidden={judged ? undefined : true}>{statusText(message)}</span>
          {message.awardedPoints > 0 ? (
            <span className="key-point-hits" aria-hidden="true">{'👍'.repeat(message.awardedPoints)}</span>
          ) : null}
        </span>
      </div>
      <button
        className="challenge-button"
        type="button"
        onClick={() => onChallenge?.(message)}
        aria-label={`质疑 ${nickname} 的问题`}
        disabled={!canChallenge}
      >
        {challengeLabel}
      </button>
    </article>
  );
}
