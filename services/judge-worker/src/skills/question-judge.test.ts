import { describe, expect, it } from 'vitest';
import { buildQuestionJudgePrompt, QUESTION_JUDGE_PROMPT_VERSION } from './question-judge.js';

describe('question judge prompt', () => {
  it('publishes the corrected semantic policy and version', () => {
    const prompt = buildQuestionJudgePrompt({
      puzzle_surface: 'surface',
      full_solution: 'solution',
      key_points: [{ id: '00000000-0000-4000-8000-000000000001', content: 'point' }],
      current_message: 'is the door relevant?',
    });

    expect(QUESTION_JUDGE_PROMPT_VERSION).toBe('question-judge-v2');
    expect(prompt).toContain('YES:');
    expect(prompt).toContain('NO:');
    expect(prompt).toContain('BOTH:');
    expect(prompt).toContain('IRRELEVANT:');
    expect(prompt).toContain('Verdict and key-point coverage are independent');
    expect(prompt).toContain('A BOTH message may fully cover a key point');
    expect(prompt).toContain('Do not use IRRELEVANT merely because no key point is covered');
    expect(prompt).toContain('Answer relationship questions directly');
    expect(prompt).toContain('every material fact');
  });

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
    expect(prompt).not.toContain('nickname');
    expect(prompt).not.toContain('player_identity');
    expect(prompt).not.toContain('score');
  });
});
