// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AdminPanel } from './admin-panel';

describe('AdminPanel', () => {
  it('moves from login to the preparation controls without showing stored secrets', async () => {
    const user = userEvent.setup();
    render(<AdminPanel demo />);

    await user.type(screen.getByLabelText('管理员昵称'), '主持人');
    await user.type(screen.getByLabelText('管理员密钥'), 'demo-secret');
    await user.click(screen.getByRole('button', { name: '进入管理台' }));

    expect(screen.getByRole('heading', { name: '准备下一局' })).toBeTruthy();
    expect(screen.queryByText('demo-secret')).toBeNull();
    expect(screen.getByText('当前为演示模式，提交按钮只验证界面流程。')).toBeTruthy();
  });
});
