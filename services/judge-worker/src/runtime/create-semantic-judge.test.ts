import { describe, expect, it } from 'vitest';
import type { SemanticJudge } from '@turtle-soup/contracts';
import { createSemanticJudge } from './create-semantic-judge.js';

const config = {
  databaseUrl: 'postgresql://worker:password@example.test:5432/game',
  provider: 'deepseek-harness',
  apiBaseUrl: 'http://127.0.0.1:4010/v1',
  apiKey: 'test-key',
  timeoutMs: 10_000,
  workerId: 'worker-1',
  buildVersion: 'test-build',
  skillConfigs: {
    'key-point-extraction': { model: 'extract-model', reasoningEffort: 'high' as const },
    'question-judge': { model: 'question-model', reasoningEffort: 'off' as const },
    'final-answer-judge': { model: 'final-model', reasoningEffort: 'max' as const },
  },
};

describe('createSemanticJudge', () => {
  it('routes each SemanticJudge method to its configured skill runtime', async () => {
    const invocations: string[] = [];
    const runtime = createSemanticJudge(config, {
      createJudge: (skill, selected) => {
        invocations.push(`${skill}:${selected.model}:${selected.reasoningEffort}`);
        return {
          extractKeyPoints: async () => ({ key_points: [{ content: 'point' }] }),
          judgeQuestion: async () => ({ verdict: 'YES', fully_covered_key_point_ids: [] }),
          judgeFinalAnswer: async () => ({ covered_key_point_ids: [] }),
        } satisfies SemanticJudge;
      },
    });

    await runtime.judge.extractKeyPoints({ puzzle_surface: 'surface', full_solution: 'solution' });
    await runtime.judge.judgeQuestion({ puzzle_surface: 'surface', full_solution: 'solution', key_points: [], current_message: 'question' });
    await runtime.judge.judgeFinalAnswer({ key_points: [], final_answer: 'answer' });

    expect(invocations).toEqual([
      'key-point-extraction:extract-model:high',
      'question-judge:question-model:off',
      'final-answer-judge:final-model:max',
    ]);
    expect(runtime.metadata['question-judge']).toMatchObject({
      provider: 'deepseek-harness',
      model: 'question-model',
      reasoningEffort: 'off',
      promptVersion: 'question-judge-v2',
      schemaVersion: 'judge-schema-v1',
    });
  });
});
