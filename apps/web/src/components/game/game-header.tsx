import type { GameStatus, PublicGame } from '@turtle-soup/contracts';
import Link from 'next/link';
import { ConnectionStatusBadge } from './connection-status';
import type { ConnectionStatus } from '@/hooks/use-game-realtime';

const statusLabels: Record<GameStatus, string> = {
  WAITING: '准备中',
  ACTIVE: '进行中',
  ENDED: '已结束',
};

export function GameHeader({ game, playerCount, connection, activePlayer }: { game: PublicGame; playerCount: number; connection: ConnectionStatus; activePlayer?: string }) {
  return (
    <header className="game-header">
      <div>
        <p className="eyebrow">海龟汤 / 单局现场</p>
        <h1>一起把故事拼完整</h1>
      </div>
      <div className="header-meta">
        <span className="status-pill">{statusLabels[game.status]}</span>
        <span className="muted">{playerCount} 位玩家</span>
        {activePlayer ? <span className="muted">你是 {activePlayer}</span> : null}
        <ConnectionStatusBadge status={connection} />
        <Link className="text-link" href="/admin">管理入口</Link>
      </div>
    </header>
  );
}
