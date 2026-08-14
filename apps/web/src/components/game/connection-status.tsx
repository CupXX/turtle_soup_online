import type { ConnectionStatus } from '@/hooks/use-game-realtime';

const labels: Record<ConnectionStatus, string> = {
  CONNECTED: '实时已连接',
  RECONNECTING: '正在重新连接',
  OFFLINE: '离线，自动重试中',
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  return <span className={`connection-badge connection-${status.toLowerCase()}`}>{labels[status]}</span>;
}
