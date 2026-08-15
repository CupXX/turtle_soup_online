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

    expect(QUESTION_JUDGE_PROMPT_VERSION).toBe('question-judge-v4');
    expect(prompt).toContain('return YES');
    expect(prompt).toContain('return NO');
    expect(prompt).toContain('PHASE C - VERDICT');
    expect(prompt).toContain('return IRRELEVANT');
    expect(prompt).toContain('Determine key-point coverage independently from the overall verdict');
    expect(prompt).toContain('A TRUE proposition inside a BOTH message may cover one or more key points');
    expect(prompt).toContain('An unspecified incidental attribute is INCIDENTAL/UNSPECIFIED');
    expect(prompt).toContain('evaluate the relationship itself');
    expect(prompt).toContain('explicit relevance-direction proposition');
    expect(prompt).toContain('semantic entailment, ordinary narrative consequences');
    expect(prompt).toContain('MATERIAL AMBIGUITY');
    expect(prompt).toContain('definition boundary');
    expect(prompt).toContain('NARROW SURFACE-EVENT SLOT BINDING');
    expect(prompt).toContain('physical contact or result versus intended target');
    expect(prompt).toContain('A TRUE proposition inside a BOTH message');
    expect(prompt).toContain('Return every fully covered key-point ID');
    expect(prompt).toContain('explicitly state or unambiguously entail');
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
    expect(prompt).not.toContain('"conversation_history":');
    expect(prompt).not.toContain('"discovered_key_points":');
    expect(prompt).not.toContain('"nickname":');
    expect(prompt).not.toContain('"player_identity":');
    expect(prompt).not.toContain('"score":');
  });
});
