import type { PublicPlayer } from '@turtle-soup/contracts';
import { MessageRow, type GameMessage } from './message-row';

export type { GameMessage } from './message-row';

type MessageFeedProps = {
  messages: GameMessage[];
  players: PublicPlayer[];
  onChallenge?: (message: GameMessage) => void;
};

export function MessageFeed({ messages, players, onChallenge }: MessageFeedProps) {
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
        <div className="empty-state"><strong>还没有问题</strong><span>从故事表面开始，提出第一个可验证的问题。</span></div>
      )}
    </section>
  );
}
