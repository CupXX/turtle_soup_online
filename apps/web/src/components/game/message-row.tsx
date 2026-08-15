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
  return (
    <article className="message-row" data-owner={isOwn ? 'self' : 'other'} data-status={message.status}>
      <div className="message-meta">
        <span className="message-sequence">#{message.sequenceNo}</span>
        <strong>{nickname}</strong>
      </div>
      <p className="message-body">{message.content}</p>
      <div className="message-result" aria-label={judged ? `判定 ${message.verdict}` : statusText(message)}>
        <span className="reaction" aria-hidden={judged ? undefined : true}>{statusText(message)}</span>
        {message.awardedPoints > 0 ? <span className="points">+{message.awardedPoints}</span> : null}
      </div>
      <button
        className="challenge-button"
        type="button"
        onClick={() => onChallenge?.(message)}
        aria-label={`质疑 ${nickname} 的问题`}
        disabled={message.status === 'SENDING'}
      >
        质疑
      </button>
    </article>
  );
}
