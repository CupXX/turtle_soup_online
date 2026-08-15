'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

type FinalAnswerModalProps = {
  open: boolean;
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (answer: string) => void;
};

export function FinalAnswerModal({ open, disabled = false, onClose, onSubmit }: FinalAnswerModalProps) {
  const [answer, setAnswer] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    inputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button, textarea');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = answer.trim();
    if (trimmed && !disabled) onSubmit(trimmed);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="final-answer-title" ref={dialogRef}>
        <div className="modal-heading">
          <div>
            <p className="eyebrow">只发送给判定服务</p>
            <h2 id="final-answer-title">提交正答</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭正答窗口">×</button>
        </div>
        <p className="privacy-note">正答不会出现在公共问题流中。失败后只有当前页面暂时保留你输入的文字。</p>
        <form className="stack-form" onSubmit={handleSubmit}>
          <label htmlFor="final-answer-input">正答</label>
          <textarea
            id="final-answer-input"
            ref={inputRef}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            maxLength={4000}
            rows={7}
            disabled={disabled}
            required
          />
          <div className="modal-actions">
            <button className="quiet-button" type="button" onClick={onClose}>取消</button>
            <button className="primary-button" type="submit" disabled={disabled || !answer.trim()}>提交正答</button>
          </div>
        </form>
      </div>
    </div>
  );
}
