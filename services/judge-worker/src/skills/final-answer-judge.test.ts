import { describe, expect, it } from 'vitest';
import { buildFinalAnswerJudgePrompt } from './final-answer-judge.js';

describe('final-answer judge prompt', () => {
  it('does not include the hidden solution or player-facing explanation field', () => {
    const prompt = buildFinalAnswerJudgePrompt({
      key_points: [{ id: '00000000-0000-4000-8000-000000000001', content: 'point' }],
      final_answer: 'answer',
    });

    expect(prompt).toContain('point');
    expect(prompt).toContain('answer');
    expect(prompt).toContain('UNTRUSTED_DATA');
    expect(prompt).not.toContain('full_solution');
    expect(prompt).not.toContain('explanation');
  });
});
