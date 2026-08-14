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
});
