'use client';

import { FormEvent, useState } from 'react';

export type AdminLoginInput = { nickname: string; secret: string };

type AdminLoginFormProps = {
  busy?: boolean;
  error?: string;
  onSubmit: (input: AdminLoginInput) => void | Promise<void>;
};

export function AdminLoginForm({ busy = false, error, onSubmit }: AdminLoginFormProps) {
  const [nickname, setNickname] = useState('');
  const [secret, setSecret] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedNickname = nickname.trim();
    const trimmedSecret = secret.trim();
    if (!trimmedNickname || !trimmedSecret || busy) return;
    await onSubmit({ nickname: trimmedNickname, secret: trimmedSecret });
    setSecret('');
  }

  return (
    <section className="admin-card gate-card" aria-labelledby="admin-login-title">
      <p className="eyebrow">海龟汤 / 管理入口</p>
      <h1 id="admin-login-title">进入管理台</h1>
      <p className="muted">管理员密钥只用于登录请求，不会显示在页面或公共游戏数据中。</p>
      <form className="stack-form" onSubmit={handleSubmit}>
        <label htmlFor="admin-nickname">管理员昵称</label>
        <input id="admin-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={24} autoComplete="username" required />
        <label htmlFor="admin-secret">管理员密钥</label>
        <input id="admin-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="current-password" required />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={busy || !nickname.trim() || !secret.trim()}>
          {busy ? '登录中…' : '进入管理台'}
        </button>
      </form>
    </section>
  );
}
