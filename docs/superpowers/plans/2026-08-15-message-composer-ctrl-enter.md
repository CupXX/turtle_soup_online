# Message Composer Ctrl+Enter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player submit the current question with `Ctrl+Enter` while preserving ordinary `Enter` for newlines and the existing send button for all devices.

**Architecture:** Keep `MessageComposer` as the only owner of draft text and form submission. The textarea keyboard handler will delegate to the existing form submit path with `requestSubmit()`, so trimming, disabled/submitting guards, clearing, and `onSubmit` remain defined once.

**Tech Stack:** React 19, TypeScript 7, Testing Library, user-event, Vitest, Next.js 16.

## Global Constraints

- `Ctrl+Enter` sends; ordinary `Enter` inserts a newline.
- Do not add `Meta+Enter`, plain-Enter sending, or global keyboard listeners in this change.
- Do not submit an empty draft or submit while the composer is disabled/submitting.
- Do not submit while an IME composition is active.
- Keep the visible send button and existing `onSubmit(content: string): void` contract unchanged.
- Add the visible hint `Ctrl+Enter 发送` without introducing new CSS.
- Preserve the unrelated untracked files `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, and `apps/web/tsconfig.tsbuildinfo`.

---

## File Map

- `apps/web/src/components/game/message-composer.tsx`: add the local textarea key handler and shortcut hint; all submission rules stay in the existing form handler.
- `apps/web/src/components/game/message-composer.test.tsx`: prove shortcut submission, newline preservation, and IME protection.

---

### Task 1: Submit questions with Ctrl+Enter

**Files:**
- Modify: `apps/web/src/components/game/message-composer.tsx`
- Test: `apps/web/src/components/game/message-composer.test.tsx`

**Interfaces:**
- Consumes: existing `MessageComposerProps` and `handleSubmit(event: FormEvent<HTMLFormElement>)` behavior.
- Produces: local `handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void`; no prop, API, or database changes.

- [ ] **Step 1: Add a failing shortcut test**

Import `fireEvent` and add this test before changing production code:

```tsx
it('submits once with Ctrl+Enter and clears the draft', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<MessageComposer onSubmit={onSubmit} />);

  const input = screen.getByLabelText('提出问题') as HTMLTextAreaElement;
  await user.type(input, '是不是有蚊子？');
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true });

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith('是不是有蚊子？');
  expect(input.value).toBe('');
  expect(screen.getByText('Ctrl+Enter 发送')).toBeTruthy();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @turtle-soup/web test -- src/components/game/message-composer.test.tsx
```

Expected: FAIL because `Ctrl+Enter` does not submit and the shortcut hint is absent.

- [ ] **Step 3: Add newline and IME regression tests**

Add two independent tests:

```tsx
it('keeps ordinary Enter as a newline', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<MessageComposer onSubmit={onSubmit} />);

  const input = screen.getByLabelText('提出问题') as HTMLTextAreaElement;
  await user.type(input, '第一行{enter}第二行');

  expect(onSubmit).not.toHaveBeenCalled();
  expect(input.value).toBe('第一行\n第二行');
});

it('does not submit Ctrl+Enter during IME composition', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<MessageComposer onSubmit={onSubmit} />);

  const input = screen.getByLabelText('提出问题') as HTMLTextAreaElement;
  await user.type(input, '蚊子');
  fireEvent.keyDown(input, {
    key: 'Enter',
    code: 'Enter',
    ctrlKey: true,
    isComposing: true,
  });

  expect(onSubmit).not.toHaveBeenCalled();
  expect(input.value).toBe('蚊子');
});
```

- [ ] **Step 4: Implement the minimal textarea handler**

Change the React type import and add this handler:

```tsx
import { FormEvent, KeyboardEvent, useState } from 'react';

function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== 'Enter' || !event.ctrlKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}
```

Attach it to the existing textarea:

```tsx
<textarea
  id="question-input"
  value={content}
  onChange={(event) => setContent(event.target.value)}
  onKeyDown={handleKeyDown}
  maxLength={500}
  rows={2}
  placeholder="用一个问题推进推理…"
  disabled={disabled || submitting}
/>
```

Replace only the existing counter span:

```tsx
<span className="muted">Ctrl+Enter 发送</span>
<span className="muted">{content.length}/500</span>
```

Do not duplicate trimming or call `onSubmit` from the keyboard handler; `requestSubmit()` must reuse `handleSubmit`.

- [ ] **Step 5: Run focused and Web verification**

Run:

```powershell
pnpm --filter @turtle-soup/web test -- src/components/game/message-composer.test.tsx
pnpm --filter @turtle-soup/web typecheck
pnpm --filter @turtle-soup/web lint
pnpm --filter @turtle-soup/web build
```

Expected: all commands pass; the focused suite proves one shortcut submission, ordinary newline behavior, IME protection, and the existing disabled-button behavior.

- [ ] **Step 6: Commit only the composer change**

```powershell
git add -- apps/web/src/components/game/message-composer.tsx apps/web/src/components/game/message-composer.test.tsx
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: submit questions with ctrl enter"
```

Expected staged files: exactly the component and its test.

---

## Plan Self-Review Checklist

- [ ] `Ctrl+Enter` uses the existing form path instead of duplicating submission rules.
- [ ] Ordinary Enter and Chinese IME composition cannot accidentally send.
- [ ] Disabled, submitting, empty-content, trimming, and clearing behavior remain owned by `handleSubmit`.
- [ ] No unrelated CSS, API, database, or chat-stream code changes are included.
