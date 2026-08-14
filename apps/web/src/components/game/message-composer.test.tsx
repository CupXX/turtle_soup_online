// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
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
});
