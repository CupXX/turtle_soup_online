// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdminKeyPoints } from './admin-key-points';

describe('AdminKeyPoints', () => {
  it('renders an ordered read-only list without editing controls', () => {
    render(<AdminKeyPoints keyPoints={[{ ordinal: 1, content: '被蚊子叮醒' }]} />);

    expect(screen.getByRole('heading', { name: '已提取的关键点' })).toBeTruthy();
    expect(screen.getByText('被蚊子叮醒')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
