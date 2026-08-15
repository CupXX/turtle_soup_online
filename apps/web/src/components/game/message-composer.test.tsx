// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MessageComposer } from './message-composer';

describe('MessageComposer', () => {
  it('submits a question and disables itself for ended games', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(<MessageComposer disabled={false} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('提出问题'), '他是不是在说谎？');
    await user.click(screen.getByRole('button', { name: '发送问题' }));
    expect(onSubmit).toHaveBeenCalledWith('他是不是在说谎？');

    rerender(<MessageComposer disabled onSubmit={onSubmit} />);
    expect((screen.getByRole('button', { name: '发送问题' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('submits exactly once on Ctrl+Enter and keeps ordinary Enter as a newline', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MessageComposer onSubmit={onSubmit} />);
    const textarea = screen.getByLabelText('提出问题');

    await user.type(textarea, '第一行');
    await user.keyboard('{Enter}');
    await user.type(textarea, '第二行');
    expect((textarea as HTMLTextAreaElement).value).toBe('第一行\n第二行');

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('第一行\n第二行');
  });

  it('does not submit Ctrl+Enter while an IME composition is active', () => {
    const onSubmit = vi.fn();
    render(<MessageComposer onSubmit={onSubmit} />);
    const textarea = screen.getByLabelText('提出问题');
    fireEvent.change(textarea, { target: { value: '拼音中' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true, isComposing: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the keyboard shortcut hint', () => {
    render(<MessageComposer onSubmit={() => undefined} />);
    expect(screen.getByText('Ctrl+Enter 发送')).toBeTruthy();
  });
});
