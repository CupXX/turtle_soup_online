import type { PublicGameReveal } from '@turtle-soup/contracts';

export function GameRevealPanel({ reveal }: { reveal: PublicGameReveal | null }) {
  if (!reveal) return null;
  return (
    <section className="reveal-panel" aria-labelledby="reveal-title">
      <p className="eyebrow">故事揭晓</p>
      <h2 id="reveal-title">汤底</h2>
      <p className="reveal-solution">{reveal.fullSolution}</p>
      <h3>关键点</h3>
      <ol className="key-point-list">
        {reveal.keyPoints.slice().sort((left, right) => left.ordinal - right.ordinal).map((point) => (
          <li key={point.ordinal}>{point.content}</li>
        ))}
      </ol>
    </section>
  );
}
