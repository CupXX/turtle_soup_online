import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { recordChallengeJudgment } from './challenge-judgments.js';

const challengeId = '00000000-0000-4000-8000-000000000001';
const keyPointId = '00000000-0000-4000-8000-000000000002';

function fakeSql() {
  let query = '';
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
    return Promise.resolve([]) as never;
  }) as unknown as Sql;
  return { sql, get query() { return query; } };
}

describe('recordChallengeJudgment', () => {
  it('persists per-slot audit metadata and the structured result', async () => {
    const fake = fakeSql();

    await recordChallengeJudgment({
      challengeId,
      slot: 3,
      metadata: {
        provider: 'openai-responses',
        model: 'gpt-5.6-luna',
        reasoningEffort: 'medium',
        skillVersion: 'question-judge-v6',
        promptVersion: 'question-judge-v6',
        schemaVersion: 'judge-schema-v1',
      },
      verdict: 'BOTH',
      coveredKeyPointIds: [keyPointId],
      valid: true,
      errorCode: null,
      latencyMs: 321,
      inputTokens: 100,
      outputTokens: 50,
    }, { sql: fake.sql, idFactory: () => '00000000-0000-4000-8000-000000000003' });

    expect(fake.query.toLowerCase()).toContain('insert into private.challenge_judgments');
    expect(fake.query.toLowerCase()).toContain('on conflict (challenge_id, slot) do update');
    expect(fake.query).toContain('openai-responses');
    expect(fake.query).toContain('gpt-5.6-luna');
    expect(fake.query).toContain('question-judge-v6');
    expect(fake.query).toContain('judge-schema-v1');
    expect(fake.query).toContain('321');
  });

  it('rejects slots outside the four fresh-judgment range', async () => {
    await expect(recordChallengeJudgment({
      challengeId,
      slot: 5,
      metadata: {
        provider: 'openai-responses',
        model: 'gpt-5.6-luna',
        reasoningEffort: 'none',
        skillVersion: 'question-judge-v6',
        promptVersion: 'question-judge-v6',
        schemaVersion: 'judge-schema-v1',
      },
      verdict: null,
      coveredKeyPointIds: [],
      valid: false,
      errorCode: 'SCHEMA_INVALID',
      latencyMs: null,
    }, { sql: fakeSql().sql })).rejects.toThrow('INVALID_CHALLENGE_SLOT');
  });
});
