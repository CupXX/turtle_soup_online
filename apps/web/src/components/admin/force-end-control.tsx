'use client';

import { FormEvent, useState } from 'react';

type ForceEndControlProps = {
  disabled?: boolean;
  disabledMessage?: string;
  error?: string;
  onConfirm: () => void | Promise<void>;
};

export function ForceEndControl({ disabled = false, disabledMessage, error, onConfirm }: ForceEndControlProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== 'FORCE_END' || disabled || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      setConfirmation('');
      setExpanded(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-card danger-card" aria-labelledby="force-end-title">
      <p className="eyebrow">不可逆操作</p>
      <h2 id="force-end-title">结束当前游戏</h2>
      <p className="muted">强制结束会公开最终揭示并取消尚未判定的动作。只有确认短语正确时按钮才会生效。</p>
      {disabled && disabledMessage ? <p className="muted">{disabledMessage}</p> : null}
      {!expanded ? (
        <button className="quiet-button" type="button" onClick={() => setExpanded(true)} disabled={disabled}>结束当前游戏</button>
      ) : (
        <form className="stack-form" onSubmit={handleSubmit}>
          <label htmlFor="force-end-confirmation">输入确认短语</label>
          <input id="force-end-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="FORCE_END" autoComplete="off" />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="modal-actions">
            <button className="quiet-button" type="button" onClick={() => setExpanded(false)}>取消</button>
            <button className="primary-button" type="submit" disabled={disabled || busy || confirmation !== 'FORCE_END'}>{busy ? '处理中…' : '确认强制结束'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
