// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FinalAnswerModal } from './final-answer-modal';

describe('FinalAnswerModal', () => {
  it('submits privately and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(<FinalAnswerModal open onClose={onClose} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('最终答案'), '他发现了真相。');
    await user.click(screen.getByRole('button', { name: '提交最终答案' }));
    expect(onSubmit).toHaveBeenCalledWith('他发现了真相。');

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
