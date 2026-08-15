import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import type { JudgeAttemptRecord } from './judge-attempts.js';
import { recordJudgeAttempt } from './judge-attempts.js';

const record: JudgeAttemptRecord = {
  parent: { actionId: '00000000-0000-4000-8000-000000000001', attemptNo: 1 },
  skill: 'question-judge',
  provider: 'deepseek-harness',
  model: 'deepseek-v4-pro',
  reasoningEffort: 'high',
  skillVersion: 'question-judge-v2',
  promptVersion: 'question-judge-v2',
  schemaVersion: 'judge-schema-v1',
  latencyMs: 12,
  inputTokens: null,
  outputTokens: null,
  resultValid: true,
  errorCode: null,
};

describe('recordJudgeAttempt', () => {
  it('inserts only private metadata and does not serialize prompt or model content', async () => {
    const calls: string[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, ''));
      return Promise.resolve([]);
    }) as unknown as Sql;

    await recordJudgeAttempt(record, { sql, idFactory: () => '00000000-0000-4000-8000-000000000002' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('private.judge_attempts');
    expect(calls[0]).toContain('skill_type');
    expect(calls[0]).toContain('reasoning_effort');
    expect(calls[0]).not.toContain('puzzle_surface');
    expect(calls[0]).not.toContain('full_solution');
    expect(calls[0]).not.toContain('answer');
    expect(calls[0]).not.toContain('reasoning_content');
  });
});
