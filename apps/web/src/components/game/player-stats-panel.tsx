import type { PublicPlayerStats } from '@turtle-soup/contracts';

type PlayerStatsPanelProps = {
  stats: PublicPlayerStats[];
};

function sortedStats(stats: PublicPlayerStats[]): PublicPlayerStats[] {
  return stats.slice().sort((left, right) =>
    right.lifetimeScore - left.lifetimeScore
      || right.yesCount - left.yesCount
      || left.displayNickname.localeCompare(right.displayNickname, 'zh-CN'),
  );
}

export function PlayerStatsPanel({ stats }: PlayerStatsPanelProps) {
  return (
    <section className="stats-panel" aria-labelledby="stats-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">本局协作</p>
          <h2 id="stats-title">玩家统计</h2>
        </div>
        <span className="muted">分数为累计分</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th scope="col">玩家</th><th scope="col">分数</th><th scope="col">命中率</th></tr>
          </thead>
          <tbody>
            {sortedStats(stats).map((player) => (
              <tr key={player.playerId}>
                <th scope="row">{player.displayNickname}</th>
                <td>{player.lifetimeScore}</td>
                <td>{player.hitRate === null ? '—' : `${Math.round(player.hitRate * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
