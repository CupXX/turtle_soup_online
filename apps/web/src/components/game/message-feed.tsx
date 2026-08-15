import type { PublicGameEvent, PublicPlayer } from '@turtle-soup/contracts';
import { MessageRow, type GameMessage } from './message-row';

export type { GameMessage } from './message-row';

type MessageFeedProps = {
  messages: GameMessage[];
  players: PublicPlayer[];
  events?: PublicGameEvent[];
  onChallenge?: (message: GameMessage) => void;
};

function eventLabel(eventType: PublicGameEvent['eventType'], nickname?: string): string {
  if (eventType === 'FINAL_ANSWER_FAILED') return `${nickname ?? '匿名玩家'} 提交了正答：❌ 失败`;
  if (eventType === 'FINAL_ANSWER_SUCCEEDED') return `${nickname ?? '匿名玩家'} 提交了正答：✅ 成功`;
  return '管理员结束了本局';
}

export function MessageFeed({ messages, players, events = [], onChallenge }: MessageFeedProps) {
  const names = new Map(players.map((player) => [player.id, player.displayNickname]));
  return (
    <section className="feed-panel" aria-labelledby="feed-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">公共问题流</p>
          <h2 id="feed-title">大家正在问什么</h2>
        </div>
        <span className="muted">按服务器顺序</span>
      </div>
      {messages.length ? (
        <div className="message-list">
          {messages.slice().sort((left, right) => left.sequenceNo - right.sequenceNo).map((message) => (
            <MessageRow key={message.id} message={message} nickname={names.get(message.playerId) ?? '匿名玩家'} onChallenge={onChallenge} />
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
