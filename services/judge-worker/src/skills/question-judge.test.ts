import { describe, expect, it } from 'vitest';
import { buildQuestionJudgePrompt } from './question-judge.js';

describe('question judge prompt', () => {
  it('includes only the fixed input and current message', () => {
    const prompt = buildQuestionJudgePrompt({
      puzzle_surface: 'surface',
      full_solution: 'solution',
      key_points: [{ id: '00000000-0000-4000-8000-000000000001', content: 'point' }],
      current_message: 'is the door relevant?',
    });

    expect(prompt).toContain('surface');
    expect(prompt).toContain('solution');
    expect(prompt).toContain('is the door relevant?');
    expect(prompt).toContain('UNTRUSTED_DATA');
    expect(prompt).not.toContain('conversation_history');
    expect(prompt).not.toContain('discovered_key_points');
  });
});
