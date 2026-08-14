'use client';

import { FormEvent, useState } from 'react';

type MessageComposerProps = {
  disabled?: boolean;
  submitting?: boolean;
  error?: string;
  onSubmit: (content: string) => void;
};

export function MessageComposer({ disabled = false, submitting = false, error, onSubmit }: MessageComposerProps) {
  const [content, setContent] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = content.trim();
    if (trimmed && !disabled && !submitting) {
      onSubmit(trimmed);
      setContent('');
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <label htmlFor="question-input">提出问题</label>
      <div className="composer-row">
        <textarea
          id="question-input"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={500}
          rows={2}
          placeholder="用一个问题推进推理…"
          disabled={disabled || submitting}
        />
        <button className="primary-button" type="submit" disabled={disabled || submitting || !content.trim()}>
          {submitting ? '发送中…' : '发送问题'}
        </button>
      </div>
      <div className="composer-footer">
        <span className="muted">{content.length}/500</span>
        {error ? <span className="form-error" role="alert">{error}</span> : null}
      </div>
    </form>
  );
}
