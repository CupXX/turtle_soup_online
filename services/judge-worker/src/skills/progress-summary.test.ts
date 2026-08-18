import { describe, expect, it } from 'vitest';

type ProgressSummarySkill = {
  PROGRESS_SUMMARY_PROMPT_VERSION: string;
  buildProgressSummaryPrompt: (input: {
    questions: Array<{ sequence_no: number; question: string; verdict: 'YES' | 'NO' | 'BOTH' | 'IRRELEVANT' }>;
  }) => string;
};

async function loadProgressSummarySkill(): Promise<ProgressSummarySkill> {
  const module = await import('./progress-summary.js').catch(() => null);
  expect(module).not.toBeNull();
  return module as unknown as ProgressSummarySkill;
}

describe('progress summary prompt', () => {
  it('publishes the version and the three-category semantic policy', async () => {
    const skill = await loadProgressSummarySkill();
    const prompt = skill.buildProgressSummaryPrompt({
      questions: [
        { sequence_no: 1, question: '男人杀死了妻子吗？', verdict: 'YES' },
        { sequence_no: 2, question: '这是自杀吗？', verdict: 'NO' },
        { sequence_no: 3, question: '天气重要吗？', verdict: 'IRRELEVANT' },
        { sequence_no: 4, question: '男人是否在现场？', verdict: 'BOTH' },
      ],
    });

    expect(skill.PROGRESS_SUMMARY_PROMPT_VERSION).toBe('progress-summary-v1');
    expect(prompt).toContain('confirmed_facts');
    expect(prompt).toContain('ruled_out_facts');
    expect(prompt).toContain('irrelevant_topics');
    expect(prompt).toContain('YES');
    expect(prompt).toContain('NO');
    expect(prompt).toContain('IRRELEVANT');
    expect(prompt).toContain('BOTH');
    expect(prompt).toContain('Do not invent');
    expect(prompt).toContain('UNTRUSTED_DATA');
  });

  it('serializes only public question text and current verdict rows as model input', async () => {
    const skill = await loadProgressSummarySkill();
    const input = {
      questions: [{ sequence_no: 10, question: '这件事与天气有关吗？', verdict: 'IRRELEVANT' as const }],
    };
    const prompt = skill.buildProgressSummaryPrompt(input);

    expect(prompt).toContain(JSON.stringify(input));
    expect(prompt).not.toContain('full_solution');
    expect(prompt).not.toContain('key_points');
    expect(prompt).not.toContain('Evidence');
    expect(prompt).not.toContain('awardedPoints');
    expect(prompt).not.toContain('score');
  });

  it('requires concise deduplicated natural-language facts and exactly one JSON object', async () => {
    const skill = await loadProgressSummarySkill();
    const prompt = skill.buildProgressSummaryPrompt({ questions: [] });

    expect(prompt).toContain('0–4');
    expect(prompt).toContain('1–120');
    expect(prompt).toMatch(/merge/i);
    expect(prompt).toContain('exactly one JSON object');
    expect(prompt).toContain('grammatical negation');
    expect(prompt).toContain('broad direction');
  });
});
