import { describe, expect, it } from 'vitest';
import { HarnessSemanticJudge } from './harness-semantic-judge.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('Harness semantic judge adapter', () => {
  it('validates provider output before returning it to worker code', async () => {
    const calls: Array<{ skill: string; prompt: string }> = [];
    const judge = new HarnessSemanticJudge(async (request) => {
      calls.push({ skill: request.skill, prompt: request.prompt });
      return { verdict: 'YES', fully_covered_key_point_ids: [id] };
    });

    await expect(judge.judgeQuestion({
      puzzle_surface: 'surface',
      full_solution: 'solution',
      key_points: [{ id, content: 'point' }],
      current_message: 'question',
    })).resolves.toEqual({ verdict: 'YES', fully_covered_key_point_ids: [id] });
    expect(calls[0]?.skill).toBe('question-judge');
  });

  it('maps malformed provider output to a stable schema error', async () => {
    const judge = new HarnessSemanticJudge(async () => ({ verdict: 'MAYBE', fully_covered_key_point_ids: [] }));

    await expect(judge.judgeQuestion({
      puzzle_surface: 'surface',
      full_solution: 'solution',
      key_points: [{ id, content: 'point' }],
      current_message: 'question',
    })).rejects.toThrow(/SCHEMA_INVALID/);
  });

  it('invokes and validates the progress-summary skill with public rows only', async () => {
    const calls: Array<{ skill: string; prompt: string; schema: Record<string, unknown> }> = [];
    const judge = new HarnessSemanticJudge(async (request) => {
      calls.push(request);
      return { confirmed_facts: ['事实'], ruled_out_facts: [], irrelevant_topics: [] };
    });
    const summarize = (judge as unknown as {
      summarizeProgress?: (input: { questions: Array<{ sequence_no: number; question: string; verdict: 'YES' | 'NO' | 'BOTH' | 'IRRELEVANT' }> }) => Promise<unknown>;
    }).summarizeProgress;
    expect(summarize).toBeTypeOf('function');
    if (!summarize) return;

    await expect(summarize.call(judge, {
      questions: [{ sequence_no: 1, question: '天气重要吗？', verdict: 'IRRELEVANT' }],
    })).resolves.toEqual({ confirmed_facts: ['事实'], ruled_out_facts: [], irrelevant_topics: [] });
    expect(calls[0]?.skill).toBe('progress-summary');
    expect(calls[0]?.prompt).toContain('天气重要吗？');
    expect(calls[0]?.schema.required).toEqual(['confirmed_facts', 'ruled_out_facts', 'irrelevant_topics']);
  });
});
