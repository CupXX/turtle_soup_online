// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExtractionStatus } from './extraction-status';

describe('ExtractionStatus', () => {
  it('shows a safe status message and exposes retry only when needed', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(<ExtractionStatus status="FAILED" message="判定服务暂时不可用。" onRetry={onRetry} />);

    expect(screen.getByText('判定服务暂时不可用。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重试线索提取' }));
    expect(onRetry).toHaveBeenCalled();

    rerender(<ExtractionStatus status="READY" message="线索已准备好，可以激活游戏。" onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: '重试线索提取' })).toBeNull();
  });
});
