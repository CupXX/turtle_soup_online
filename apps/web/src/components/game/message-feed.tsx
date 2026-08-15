import type { PublicGameEvent, PublicPlayer } from '@turtle-soup/contracts';
import { MessageRow, type GameMessage } from './message-row';

export type { GameMessage } from './message-row';

type MessageFeedProps = {
  messages: GameMessage[];
  players: PublicPlayer[];
  currentPlayerId?: string;
  events?: PublicGameEvent[];
  onChallenge?: (message: GameMessage) => void;
};

function eventLabel(eventType: PublicGameEvent['eventType'], nickname?: string): string {
  if (eventType === 'FINAL_ANSWER_FAILED') return `${nickname ?? '匿名玩家'} 提交了正答：❌ 失败`;
  if (eventType === 'FINAL_ANSWER_SUCCEEDED') return `${nickname ?? '匿名玩家'} 提交了正答：✅ 成功`;
  return '管理员结束了本局';
}

export function MessageFeed({ messages, players, currentPlayerId, events = [], onChallenge }: MessageFeedProps) {
  const names = new Map(players.map((player) => [player.id, player.displayNickname]));
  return (
    <section className="feed-panel" aria-label="对话流">
      <div className="verdict-legend" aria-label="判定图例">
        <span>✅ 是</span>
        <span>❌ 不是</span>
        <span>❓ 是也不是</span>
        <span>👎 与此无关</span>
      </div>
      {messages.length ? (
        <div className="message-list">
          {messages.slice().sort((left, right) => left.sequenceNo - right.sequenceNo).map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              nickname={names.get(message.playerId) ?? '匿名玩家'}
              isOwn={Boolean(currentPlayerId && message.playerId === currentPlayerId)}
              onChallenge={onChallenge}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state"><strong>还没有问题</strong><span>从汤面开始，提出第一个可验证的问题。</span></div>
      )}
      {events.length ? (
        <div className="message-event-list" aria-live="polite">
          {events.slice().sort((left, right) => left.sequenceNo - right.sequenceNo).map((event) => (
            <article className="message-event-row" key={event.id} data-event-type={event.eventType}>
              <span>#{event.sequenceNo}</span>
              <span>{eventLabel(event.eventType, event.playerId ? names.get(event.playerId) : undefined)}</span>
              {event.awardedPoints > 0 ? <span>+{event.awardedPoints}</span> : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
