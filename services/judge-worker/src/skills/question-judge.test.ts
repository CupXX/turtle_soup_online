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

    expect(QUESTION_JUDGE_PROMPT_VERSION).toBe('question-judge-v3');
    expect(prompt).toContain('YES:');
    expect(prompt).toContain('NO:');
    expect(prompt).toContain('BOTH has');
    expect(prompt).toContain('IRRELEVANT:');
    expect(prompt).toContain('Determine verdict independently from key-point coverage');
    expect(prompt).toContain('a true proposition inside BOTH may cover one or more key points');
    expect(prompt).toContain('Missing from full_solution is not by itself false');
    expect(prompt).toContain('answer the direction itself');
    expect(prompt).toContain('Missing from full_solution is not by itself false');
    expect(prompt).toContain('explicit relevance-direction question');
    expect(prompt).toContain('semantic entailment, not keyword matching');
    expect(prompt).toContain('material ambiguity');
    expect(prompt).toContain('definition boundary');
    expect(prompt).toContain('unique concrete object, agent, or result');
    expect(prompt).toContain('physical contact/result or to intended target/purpose');
    expect(prompt).toContain('preserve the true proposition for key-point coverage');
    expect(prompt).toContain('Return every fully covered key-point ID');
    expect(prompt).toContain('explicitly states or unambiguously entails');
    expect(prompt).not.toContain('这个人死了吗');
    expect(prompt).not.toContain('故事里还有第二个人吗');
    expect(prompt).not.toContain('是不是有蚊子');
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
