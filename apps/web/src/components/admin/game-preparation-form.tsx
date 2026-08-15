'use client';

import { FormEvent, useState } from 'react';

export type GamePreparationInput = { puzzleSurface: string; fullSolution: string };

type GamePreparationFormProps = {
  busy?: boolean;
  error?: string;
  onSubmit: (input: GamePreparationInput) => void | Promise<void>;
};

export function GamePreparationForm({ busy = false, error, onSubmit }: GamePreparationFormProps) {
  const [puzzleSurface, setPuzzleSurface] = useState('');
  const [fullSolution, setFullSolution] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const surface = puzzleSurface.trim();
    const solution = fullSolution.trim();
    if (!surface || !solution || busy) return;
    await onSubmit({ puzzleSurface: surface, fullSolution: solution });
  }

  return (
    <section className="admin-card" aria-labelledby="preparation-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">单局生命周期</p>
          <h2 id="preparation-title">准备下一局</h2>
        </div>
        <span className="status-pill">WAITING</span>
      </div>
      <p className="muted">汤面会在激活后公开；汤底只交给服务端判定和关键点提取流程。</p>
      <form className="stack-form" onSubmit={handleSubmit}>
        <label htmlFor="puzzle-surface">汤面</label>
        <textarea id="puzzle-surface" value={puzzleSurface} onChange={(event) => setPuzzleSurface(event.target.value)} maxLength={4000} rows={5} required />
        <label htmlFor="full-solution">汤底（仅判定服务可见）</label>
        <textarea id="full-solution" value={fullSolution} onChange={(event) => setFullSolution(event.target.value)} maxLength={12000} rows={8} required />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={busy || !puzzleSurface.trim() || !fullSolution.trim()}>
          {busy ? '保存中…' : '创建等待中的游戏'}
        </button>
      </form>
    </section>
  );
}
