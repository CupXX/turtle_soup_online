'use client';

import { FormEvent, useState } from 'react';

type NicknameGateProps = {
  onSubmit: (nickname: string) => void;
  error?: string;
  busy?: boolean;
};

export function NicknameGate({ onSubmit, error, busy = false }: NicknameGateProps) {
  const [nickname, setNickname] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = nickname.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  }

  return (
    <section className="gate-card" aria-labelledby="nickname-title">
      <p className="eyebrow">多人推理现场</p>
      <h1 id="nickname-title">先留下你的昵称</h1>
      <p className="muted">昵称会显示在对话流和本局统计中。</p>
      <form className="stack-form" onSubmit={handleSubmit}>
        <label htmlFor="nickname">昵称</label>
        <input
          id="nickname"
          name="nickname"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          maxLength={24}
          autoComplete="nickname"
          required
        />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={busy || !nickname.trim()}>
          {busy ? '正在进入…' : '进入游戏'}
        </button>
      </form>
    </section>
  );
}
