import type { PublicGame } from '@turtle-soup/contracts';

export function PuzzlePanel({ game }: { game: PublicGame }) {
  return (
    <section className="puzzle-panel" aria-labelledby="puzzle-title">
      <div className="section-heading">
        <div>
          <h2 id="puzzle-title">当前汤面</h2>
        </div>
        <span className="progress-label">{game.discoveredKeyPointCount}/{game.keyPointTotal || '—'} 关键点已发现</span>
      </div>
      {game.puzzleSurface ? (
        <p className="puzzle-copy">{game.puzzleSurface}</p>
      ) : (
        <div className="waiting-state"><strong>汤面正在准备</strong><span>管理员完成关键点提取后，这里会显示汤面。</span></div>
      )}
      <div className="progress-track" aria-label="关键点发现进度">
        <span style={{ width: `${game.keyPointTotal ? Math.min(100, (game.discoveredKeyPointCount / game.keyPointTotal) * 100) : 0}%` }} />
      </div>
    </section>
  );
}
