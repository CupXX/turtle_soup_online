import { describe, expect, it, vi } from 'vitest';
import type { SemanticJudge } from '@turtle-soup/contracts';
import { JudgeValidationError } from '../skills/validate-result.js';
import type { JudgeRuntime } from './create-semantic-judge.js';
import { createAuditedSemanticJudge } from './audited-semantic-judge.js';
import type { JudgeAttemptRecord } from '../db/judge-attempts.js';

const metadata = {
  provider: 'deepseek-harness',
  model: 'deepseek-v4-pro',
  reasoningEffort: 'high' as const,
  skillVersion: 'question-judge-v2',
  promptVersion: 'question-judge-v2',
  schemaVersion: 'judge-schema-v1' as const,
};

function runtime(judge: SemanticJudge): JudgeRuntime {
  return {
    judge,
    metadata: {
      'key-point-extraction': { ...metadata, skillVersion: 'key-point-extraction-v2', promptVersion: 'key-point-extraction-v2' },
      'question-judge': metadata,
      'final-answer-judge': { ...metadata, skillVersion: 'final-answer-judge-v1', promptVersion: 'final-answer-judge-v1' },
    },
  };
}

const questionInput = {
  puzzle_surface: 'surface',
  full_solution: 'solution',
  key_points: [],
  current_message: 'question',
};

describe('createAuditedSemanticJudge', () => {
  it('records a safe metadata row on success and returns the result unchanged', async () => {
    const judge: SemanticJudge = {
      extractKeyPoints: async () => ({ key_points: [] }),
      judgeQuestion: async () => ({ verdict: 'YES', fully_covered_key_point_ids: [] }),
      judgeFinalAnswer: async () => ({ covered_key_point_ids: [] }),
    };
    const records: JudgeAttemptRecord[] = [];
    const audited = createAuditedSemanticJudge(
      runtime(judge),
      { actionId: '00000000-0000-4000-8000-000000000001', attemptNo: 1 },
      async (record) => { records.push(record); },
    );

    await expect(audited.judgeQuestion(questionInput)).resolves.toEqual({ verdict: 'YES', fully_covered_key_point_ids: [] });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      parent: { actionId: '00000000-0000-4000-8000-000000000001', attemptNo: 1 },
      skill: 'question-judge',
      provider: 'deepseek-harness',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high',
      promptVersion: 'question-judge-v2',
      schemaVersion: 'judge-schema-v1',
      inputTokens: null,
      outputTokens: null,
      resultValid: true,
      errorCode: null,
      latencyMs: expect.any(Number),
    });
    expect(records[0]).not.toHaveProperty('prompt');
    expect(records[0]).not.toHaveProperty('input');
    expect(records[0]).not.toHaveProperty('output');
    expect(records[0]).not.toHaveProperty('puzzleSurface');
    expect(records[0]).not.toHaveProperty('fullSolution');
    expect(records[0]).not.toHaveProperty('answer');
    expect(records[0]).not.toHaveProperty('reasoning');
  });

  it('records validation failure, rethrows it, and does not let recorder failure change behavior', async () => {
    const validationError = new JudgeValidationError('SCHEMA_INVALID', 'bad result');
    const judge: SemanticJudge = {
      extractKeyPoints: async () => ({ key_points: [] }),
      judgeQuestion: async () => { throw validationError; },
      judgeFinalAnswer: async () => ({ covered_key_point_ids: [] }),
    };
    const recorder = vi.fn(async () => { throw new Error('audit database unavailable'); });
    const audited = createAuditedSemanticJudge(
      runtime(judge),
      { extractionJobId: '00000000-0000-4000-8000-000000000003', attemptNo: 2 },
      recorder,
    );

    await expect(audited.judgeQuestion(questionInput)).rejects.toBe(validationError);
    expect(recorder).toHaveBeenCalledWith(expect.objectContaining({
      resultValid: false,
      errorCode: 'SCHEMA_INVALID',
      parent: { extractionJobId: '00000000-0000-4000-8000-000000000003', attemptNo: 2 },
    }));
  });
});
