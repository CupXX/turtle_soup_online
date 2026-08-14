// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ForceEndControl } from './force-end-control';

describe('ForceEndControl', () => {
  it('requires the explicit confirmation phrase before force ending', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ForceEndControl onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: '结束当前游戏' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText('输入确认短语')).toBeTruthy();

    await user.type(screen.getByLabelText('输入确认短语'), 'FORCE_END');
    await user.click(screen.getByRole('button', { name: '确认强制结束' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
