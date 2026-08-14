// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminLoginForm } from './admin-login-form';

describe('AdminLoginForm', () => {
  it('submits nickname and secret without rendering the secret after submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AdminLoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('管理员昵称'), '主持人');
    await user.type(screen.getByLabelText('管理员密钥'), 'not-a-real-secret');
    await user.click(screen.getByRole('button', { name: '进入管理台' }));

    expect(onSubmit).toHaveBeenCalledWith({ nickname: '主持人', secret: 'not-a-real-secret' });
    expect((screen.getByLabelText('管理员密钥') as HTMLInputElement).value).toBe('');
  });
});
