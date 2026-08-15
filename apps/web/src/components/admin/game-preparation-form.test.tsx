// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GamePreparationForm } from './game-preparation-form';

describe('GamePreparationForm', () => {
  it('requires both public surface and private solution before submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<GamePreparationForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('汤面'), '有人在海边捡到了一把伞。');
    await user.click(screen.getByRole('button', { name: '创建等待中的游戏' }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('汤底（仅判定服务可见）'), '答案不会显示给玩家。');
    await user.click(screen.getByRole('button', { name: '创建等待中的游戏' }));
    expect(onSubmit).toHaveBeenCalledWith({
      puzzleSurface: '有人在海边捡到了一把伞。',
      fullSolution: '答案不会显示给玩家。',
    });
  });
});
