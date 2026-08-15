import { readFileSync } from 'node:fs';
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

    expect(QUESTION_JUDGE_PROMPT_VERSION).toBe('question-judge-v6');
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
    expect(prompt).toContain('Prefer the ordinary contextual reading');
    expect(prompt).toContain('intention marker');
    expect(prompt).toContain('physical action or over the stated target or result');
    expect(prompt).toContain('Ordinary transitive action wording alone');
    expect(prompt).toContain('direct and ordinary competing explanation');
    expect(prompt).toContain('If that explanatory direction conflicts with the canonical solution, evaluate it as FALSE');
    expect(prompt).not.toContain('broad evaluative category');
    expect(prompt).not.toContain('broad or narrow definition');
    expect(prompt).toContain('NARROW SURFACE-EVENT SLOT BINDING');
    expect(prompt).toContain('directly identifying the discriminative concrete value of the missing event slot');
    expect(prompt).toContain('A person hears glass breaking');
    expect(prompt).toContain('Was it the window that broke? => YES, include the key point');
    expect(prompt).toContain('Did the sound come from the window? => YES, no key point');
    expect(prompt).toContain('A TRUE proposition inside a BOTH message');
    expect(prompt).toContain('Return every fully covered key-point ID');
    expect(prompt).toContain('explicitly state or unambiguously entail');
    expect(prompt).toContain('direct, ordinary, and contextually immediate framing or interpretation of a salient surface element');
    expect(prompt).toContain('tests a natural real-world meaning of that salient surface element');
    expect(prompt).toContain('evaluate that proposed framing as TRUE or FALSE against the canonical causal story');
    expect(prompt).toContain('NO means that a puzzle-relevant direction is wrong');
    expect(prompt).toContain('not an absolute claim about every unspecified fact in the fictional world');
    expect(prompt).toContain('The surface element must be central to the apparent anomaly');
    expect(prompt).toContain('Do not make an arbitrary association puzzle-relevant');
    expect(prompt).not.toContain('选择题');
    expect(prompt).not.toContain('试卷');
    expect(prompt).not.toContain('这个人死了吗');
    expect(prompt).not.toContain('故事里还有第二个人吗');
    expect(prompt).not.toContain('是不是有蚊子');
    expect(prompt).not.toContain('蚊香');
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

  it('matches the frozen v6 policy snapshot before runtime data', () => {
    const prompt = buildQuestionJudgePrompt({
      puzzle_surface: 'surface',
      full_solution: 'solution',
      key_points: [{ id: '00000000-0000-4000-8000-000000000001', content: 'point' }],
      current_message: 'is the door relevant?',
    });
    const policy = prompt.split('\nUNTRUSTED_DATA:\n')[0];
    const snapshot = readFileSync(new URL('./prompts/question-judge-v6.txt', import.meta.url), 'utf8');
    expect(`${policy}\n`).toBe(snapshot);
  });
});
