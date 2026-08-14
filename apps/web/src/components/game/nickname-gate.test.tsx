// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NicknameGate } from './nickname-gate';

describe('NicknameGate', () => {
  it('submits the trimmed nickname', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<NicknameGate onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('昵称'), '  Cups  ');
    await user.click(screen.getByRole('button', { name: '进入游戏' }));

    expect(onSubmit).toHaveBeenCalledWith('Cups');
  });
});
