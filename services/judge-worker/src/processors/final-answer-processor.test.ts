import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import type { SemanticJudge } from '../runtime/semantic-judge.js';
import type { ClaimedAction } from '../db/queue.js';
import { processFinalAnswer } from './final-answer-processor.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000002';
const playerId = '00000000-0000-4000-8000-000000000003';
const keyPointId = '00000000-0000-4000-8000-000000000011';
const keyPointIdTwo = '00000000-0000-4000-8000-000000000012';
const keyPointIdThree = '00000000-0000-4000-8000-000000000013';

const action: ClaimedAction = {
  id: actionId,
  gameId,
  playerId,
  sequenceNo: 1,
  actionType: 'FINAL_ANSWER',
  attempt: 1,
  leaseOwner: 'worker-1',
  leaseExpiresAt: '2099-01-01T00:00:00.000Z',
};

function fakeSql() {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
    calls.push(query);
    const normalized = query.toLowerCase();
    if (normalized.includes('from private.final_answer_submissions')) return Promise.resolve([{ answer: 'the private answer', gameId, playerId }]);
    if (normalized.includes('from private.key_points')) return Promise.resolve([
      { id: keyPointId, content: 'point', ordinal: 1 },
      { id: keyPointIdTwo, content: 'point two', ordinal: 2 },
      { id: keyPointIdThree, content: 'point three', ordinal: 3 },
    ]);
    return Promise.resolve([]);
  }) as unknown as Sql;
  return { calls, sql };
}

describe('processFinalAnswer', () => {
  it('loads only the private answer and fixed key points, judges outside the completion transaction, and passes IDs onward', async () => {
    const fake = fakeSql();
    const judge = {
      judgeFinalAnswer: async (input: { final_answer: string; key_points: Array<{ id: string; content: string }> }) => {
        expect(input.final_answer).toBe('the private answer');
        expect(input.key_points).toEqual([
          { id: keyPointId, content: 'point' },
          { id: keyPointIdTwo, content: 'point two' },
          { id: keyPointIdThree, content: 'point three' },
        ]);
        return { covered_key_point_ids: [keyPointId] };
      },
    } as unknown as SemanticJudge;
    const complete = async (input: { actionId: string; workerId: string; coveredKeyPointIds: string[] }) => {
      expect(input).toEqual({ actionId, workerId: 'worker-1', coveredKeyPointIds: [keyPointId] });
    };

    await processFinalAnswer(action as ClaimedAction & { actionType: 'FINAL_ANSWER' }, { judge, workerId: 'worker-1', sql: fake.sql, completeFinalAnswer: complete });

    expect(fake.calls.join('\n').toLowerCase()).not.toContain('api.messages');
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('game_secrets');
  });
});
