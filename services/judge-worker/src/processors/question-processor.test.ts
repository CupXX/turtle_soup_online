import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import type { SemanticJudge } from '@turtle-soup/contracts';
import { processQuestion, type ClaimedQuestionAction } from './question-processor.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000002';
const messageId = '00000000-0000-4000-8000-000000000003';
const keyPointId = '00000000-0000-4000-8000-000000000004';
const keyPointTwoId = '00000000-0000-4000-8000-000000000005';
const keyPointThreeId = '00000000-0000-4000-8000-000000000006';

function readSql() {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
    calls.push(query);
    const normalized = query.toLowerCase();
    if (normalized.includes('from private.game_actions')) return Promise.resolve([{ messageId }]);
    if (normalized.includes('from private.game_secrets')) return Promise.resolve([{ puzzleSurface: '表面', fullSolution: '真相' }]);
    if (normalized.includes('from private.key_points')) return Promise.resolve([
      { id: keyPointId, content: '关键点一', ordinal: 1 },
      { id: keyPointTwoId, content: '关键点二', ordinal: 2 },
      { id: keyPointThreeId, content: '关键点三', ordinal: 3 },
    ]);
    if (normalized.includes('from api.messages')) return Promise.resolve([{ content: '当前问题' }]);
    return Promise.resolve([]);
  }) as unknown as Sql;
  return { sql, calls };
}

function writeTransaction(order: string[]) {
  const runner = async <T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> => {
    order.push('transaction');
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
      const normalized = query.toLowerCase();
      if (normalized.includes('from private.game_actions')) {
        return Promise.resolve([{
          id: actionId,
          gameId,
          playerId: '00000000-0000-4000-8000-000000000005',
          sequenceNo: 1,
          actionType: 'NORMAL_MESSAGE',
          status: 'PROCESSING',
          leaseOwner: 'worker-1',
          leaseExpiresAt: '2099-01-01T00:00:00.000Z',
          resultResourceId: messageId,
        }] as never);
      }
      if (normalized.includes('from api.games')) return Promise.resolve([{ id: gameId, status: 'ACTIVE' }] as never);
      if (normalized.includes('from api.messages')) return Promise.resolve([{ id: messageId, gameId, status: 'PENDING' }] as never);
      if (normalized.includes('from private.key_points')) return Promise.resolve([{ id: keyPointId, gameId, ordinal: 1 }] as never);
      return Promise.resolve([] as never);
    }) as unknown as TransactionSql;
    return callback(sql);
  };
  return runner;
}

const action: ClaimedQuestionAction = {
  id: actionId,
  gameId,
  playerId: '00000000-0000-4000-8000-000000000005',
  sequenceNo: 1,
  actionType: 'NORMAL_MESSAGE',
  attempt: 1,
  leaseOwner: 'worker-1',
  leaseExpiresAt: '2099-01-01T00:00:00.000Z',
};

describe('processQuestion', () => {
  it('loads only the fixed puzzle, key points, and current message before judging', async () => {
    const read = readSql();
    const order: string[] = [];
    const judge: SemanticJudge = {
      extractKeyPoints: async () => ({ key_points: [] }),
      judgeQuestion: async (input) => {
        order.push(`judge:${input.puzzle_surface}:${input.full_solution}:${input.current_message}`);
        expect(input).toEqual({
          puzzle_surface: '表面',
          full_solution: '真相',
          key_points: [
            { id: keyPointId, content: '关键点一' },
            { id: keyPointTwoId, content: '关键点二' },
            { id: keyPointThreeId, content: '关键点三' },
          ],
          current_message: '当前问题',
        });
        return { verdict: 'YES', fully_covered_key_point_ids: [keyPointId] };
      },
      judgeFinalAnswer: async () => ({ covered_key_point_ids: [] }),
    };

    await processQuestion(action, {
      judge,
      workerId: 'worker-1',
      sql: read.sql,
      transaction: writeTransaction(order),
    });

    expect(order).toEqual(['judge:表面:真相:当前问题', 'transaction']);
    const queries = read.calls.join('\n').toLowerCase();
    expect(queries).toContain('private.game_secrets');
    expect(queries).toContain('private.key_points');
    expect(queries).toContain('api.messages');
    expect(queries).not.toContain('conversation');
    expect(queries).not.toContain('discovered');
    expect(queries).not.toContain('api.players');
  });

  it('fails before judging when the current message is missing', async () => {
    const read = readSql();
    const judge = { judgeQuestion: async () => ({ verdict: 'NO', fully_covered_key_point_ids: [] }) } as unknown as SemanticJudge;

    await expect(processQuestion(action, {
      judge,
      workerId: 'worker-1',
      sql: ((strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '').toLowerCase();
        if (query.includes('private.game_actions')) return Promise.resolve([{ messageId }]);
        if (query.includes('private.game_secrets')) return Promise.resolve([{ puzzleSurface: '表面', fullSolution: '真相' }]);
        if (query.includes('api.messages')) return Promise.resolve([]);
        return Promise.resolve([]);
      }) as unknown as Sql,
      transaction: writeTransaction([]),
    })).rejects.toThrow('QUESTION_INPUT_NOT_FOUND');
    expect(read.calls).toHaveLength(0);
  });
});
