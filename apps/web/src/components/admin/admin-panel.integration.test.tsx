// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPanel } from './admin-panel';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('uses the admin session, status, and preparation routes in production mode', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/admin/session') return Promise.resolve(new Response(JSON.stringify({ data: { nickname: '主持人' } }), { status: 200 }));
      if (url === '/api/admin/status') return Promise.resolve(new Response(JSON.stringify({ data: { gameId: 'game-1', gameStatus: 'WAITING', extractionStatus: 'PENDING', actionStatus: null, errorCode: null, workerHealthy: true, keyPoints: [] } }), { status: 200 }));
      if (url === '/api/admin/games/current/preparation') return Promise.resolve(new Response(JSON.stringify({ data: { status: 'WAITING' } }), { status: 200 }));
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminPanel />);
    await user.type(screen.getByLabelText('管理员昵称'), '主持人');
    await user.type(screen.getByLabelText('管理员密钥'), 'secret');
    await user.click(screen.getByRole('button', { name: '进入管理台' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: '准备下一局' })).toBeTruthy());
    await user.type(screen.getByLabelText('公开题面'), 'surface');
    await user.type(screen.getByLabelText('完整答案（仅判定服务可见）'), 'solution');
    await user.click(screen.getByRole('button', { name: '创建等待中的游戏' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/games/current/preparation', expect.objectContaining({ method: 'PUT' })));
  });
});
