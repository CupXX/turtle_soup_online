import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import type { QuestionJudgeInput, SemanticJudge } from '@turtle-soup/contracts';
import type { ChallengeJudgmentRecord } from '../db/challenge-judgments.js';
import { processChallenge, type ClaimedChallengeAction } from './challenge-processor.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000002';
const challengeId = '00000000-0000-4000-8000-000000000003';
const keyPointOne = '00000000-0000-4000-8000-000000000004';
const keyPointTwo = '00000000-0000-4000-8000-000000000005';
const keyPointThree = '00000000-0000-4000-8000-000000000006';

const action: ClaimedChallengeAction = {
  id: actionId,
  gameId,
  playerId: '00000000-0000-4000-0000-000000000007',
  sequenceNo: 5,
  actionType: 'CHALLENGE',
  attempt: 1,
  leaseOwner: 'worker-1',
  leaseExpiresAt: '2099-01-01T00:00:00.000Z',
};

function readSql() {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
    calls.push(query);
    const normalized = query.toLowerCase();
    if (normalized.includes('from private.game_actions')) return Promise.resolve([{ challengeId }]);
    if (normalized.includes('from private.game_secrets')) return Promise.resolve([{ puzzleSurface: '表面', fullSolution: '真相' }]);
    if (normalized.includes('from private.key_points')) return Promise.resolve([
      { id: keyPointOne, content: '关键点一', ordinal: 1 },
      { id: keyPointTwo, content: '关键点二', ordinal: 2 },
      { id: keyPointThree, content: '关键点三', ordinal: 3 },
    ]);
    if (normalized.includes('from private.question_judgments')) return Promise.resolve([{ originalVerdict: 'YES', originalCoveredKeyPointIds: [keyPointOne], promptVersion: 'question-judge-v6', schemaVersion: 'judge-schema-v1' }]);
    if (normalized.includes('from private.message_challenges')) return Promise.resolve([{ content: '当前问题' }]);
    if (normalized.includes('from private.challenge_judgments')) return Promise.resolve([]);
    return Promise.resolve([]);
  }) as unknown as Sql;
  return { sql, calls };
}

function judge(): SemanticJudge {
  return {
    extractKeyPoints: async () => ({ key_points: [] }),
    judgeQuestion: async () => ({ verdict: 'YES', fully_covered_key_point_ids: [keyPointOne] }),
    judgeFinalAnswer: async () => ({ covered_key_point_ids: [] }),
  };
}

describe('processChallenge', () => {
  it('runs four fresh judgments against the fixed input and completes with all five votes', async () => {
    const read = readSql();
    const slots: number[] = [];
    const records: ChallengeJudgmentRecord[] = [];
    const judgedInputs: QuestionJudgeInput[] = [];
    let completion: unknown;
    await processChallenge(action, {
      judge: {
        ...judge(),
        judgeQuestion: async (input) => {
          judgedInputs.push(input);
          return { verdict: 'YES', fully_covered_key_point_ids: [keyPointOne] };
        },
      },
      judgeFactory: (slot) => {
        slots.push(slot);
        return {
          ...judge(),
          judgeQuestion: async (input) => {
            judgedInputs.push(input);
            return { verdict: 'YES', fully_covered_key_point_ids: [keyPointOne] };
          },
        };
      },
      judgeMetadata: {
        provider: 'openai-responses', model: 'gpt-5.6-luna', reasoningEffort: 'medium',
        skillVersion: 'question-judge-v6', promptVersion: 'question-judge-v6', schemaVersion: 'judge-schema-v1',
      },
      workerId: 'worker-1',
      sql: read.sql,
      persistJudgment: async (record) => { records.push(record); },
      complete: async (input) => { completion = input; },
    });

    expect(slots).toEqual([1, 2, 3, 4]);
    expect(records).toHaveLength(4);
    expect(judgedInputs).toHaveLength(4);
    expect(judgedInputs.every((input) => input.current_message === '当前问题')).toBe(true);
    expect(records.every((record) => record.valid && record.challengeId === challengeId)).toBe(true);
    expect(completion).toMatchObject({ actionId, workerId: 'worker-1', challengeId });
    expect((completion as { freshJudgments: unknown[] }).freshJudgments).toHaveLength(4);
    const serialized = read.calls.join('\n').toLowerCase();
    expect(serialized).toContain('private.game_secrets');
    expect(serialized).toContain('private.key_points');
    expect(serialized).not.toContain('conversation_history');
    expect(serialized).not.toContain('discovered_key_points');
  });

  it('does not resolve when fewer than four fresh results are valid', async () => {
    const read = readSql();
    let calls = 0;
    const persist: ChallengeJudgmentRecord[] = [];
    await expect(processChallenge(action, {
      judge: {
        ...judge(),
        judgeQuestion: async () => {
          calls += 1;
          if (calls === 1) throw new Error('provider failed');
          return { verdict: 'YES', fully_covered_key_point_ids: [] };
        },
      },
      workerId: 'worker-1',
      sql: read.sql,
      persistJudgment: async (record) => { persist.push(record); },
      complete: async () => { throw new Error('should not complete'); },
    })).rejects.toThrow('SCHEMA_INVALID');
    expect(persist.filter((record) => record.valid)).toHaveLength(3);
    expect(persist.find((record) => !record.valid)?.errorCode).toBe('Error');
  });
});
