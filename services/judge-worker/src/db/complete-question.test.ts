import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { completeQuestion } from './complete-question.js';

type QueryHandler = (query: string) => unknown[];

function fakeTransaction(handler: QueryHandler) {
  const calls: string[] = [];
  const transaction = async <T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> => {
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
      calls.push(query);
      return Promise.resolve(handler(query) as never);
    }) as unknown as TransactionSql;
    return callback(sql);
  };
  return { calls, transaction };
}

const gameId = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000002';
const playerId = '00000000-0000-4000-8000-000000000003';
const messageId = '00000000-0000-4000-8000-000000000004';
const keyPointOne = '00000000-0000-4000-8000-000000000011';
const keyPointTwo = '00000000-0000-4000-8000-000000000012';

const action = {
  id: actionId,
  gameId,
  playerId,
  sequenceNo: 1,
  actionType: 'NORMAL_MESSAGE',
  status: 'PROCESSING',
  leaseOwner: 'worker-1',
  leaseExpiresAt: '2099-01-01T00:00:00.000Z',
  resultResourceId: messageId,
};

function successfulHandler(insertedClaims: string[] = [keyPointOne, keyPointTwo]): QueryHandler {
  let claimIndex = 0;
  return (query) => {
    const normalized = query.toLowerCase();
    if (normalized.includes('from private.game_actions')) return [action];
    if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
    if (normalized.includes('from api.messages')) return [{ id: messageId, gameId, playerId, status: 'PENDING' }];
    if (normalized.includes('from private.key_points')) {
      return query.includes(keyPointOne)
        ? [{ id: keyPointOne, gameId, ordinal: 1 }]
        : query.includes(keyPointTwo)
          ? [{ id: keyPointTwo, gameId, ordinal: 2 }]
          : [];
    }
    if (normalized.includes('insert into private.key_point_claims')) {
      const inserted = insertedClaims[claimIndex++];
      return inserted ? [{ keyPointId: inserted }] : [];
    }
    return [];
  };
}

describe('completeQuestion', () => {
  it.each([
    [9, 0],
    [10, 1],
    [11, 0],
    [19, 0],
    [20, 1],
  ])('schedules only the current judged boundary for legacy judgments (%s)', async (judgedCount, expectedCalls) => {
    const baseHandler = successfulHandler([]);
    const scheduled: number[] = [];
    const fake = fakeTransaction((query) => {
      if (query.toLowerCase().includes('count(*)::int as count')) return [{ count: judgedCount }];
      return baseHandler(query);
    });

    await completeQuestion({
      actionId,
      workerId: 'worker-1',
      verdict: 'YES',
      fullyCoveredKeyPointIds: [],
    }, {
      transaction: fake.transaction,
      scheduleProgressSummary: async (_sql, _gameId, boundary) => { scheduled.push(boundary); },
    });

    expect(scheduled).toHaveLength(expectedCalls);
    if (expectedCalls) expect(scheduled[0]).toBe(judgedCount);
  });

  it.each([
    [9, 0],
    [10, 1],
    [20, 1],
  ])('uses the same cadence for Evidence judgments (%s)', async (judgedCount, expectedCalls) => {
    const baseHandler = successfulHandler([]);
    const scheduled: number[] = [];
    const fake = fakeTransaction((query) => {
      if (query.toLowerCase().includes('count(*)::int as count')) return [{ count: judgedCount }];
      return baseHandler(query);
    });

    await completeQuestion({
      actionId,
      workerId: 'worker-1',
      verdict: 'YES',
      establishedEvidenceIds: [],
    }, {
      transaction: fake.transaction,
      scheduleProgressSummary: async (_sql, _gameId, boundary) => { scheduled.push(boundary); },
    });

    expect(scheduled).toHaveLength(expectedCalls);
    if (expectedCalls) expect(scheduled[0]).toBe(judgedCount);
  });

  it('publishes a YES verdict and awards only newly inserted first claims', async () => {
    const fake = fakeTransaction(successfulHandler());

    await completeQuestion({
      actionId,
      workerId: 'worker-1',
      verdict: 'YES',
      fullyCoveredKeyPointIds: [keyPointOne, keyPointTwo],
    }, { transaction: fake.transaction });

    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain('for update');
    const keyPointQuery = fake.calls.find((call) => call.toLowerCase().includes('from private.key_points')) ?? '';
    expect(keyPointQuery.toLowerCase()).not.toContain('for update');
    expect(query).toContain('on conflict (key_point_id) do nothing');
    expect(query).toContain('returning key_point_id');
    expect(query).toContain('insert into private.question_judgments');
    expect(query).toContain('original_covered_key_point_ids');
    expect(query).toContain('awarded_points = 2');
    expect(query).toContain('yes_count');
    expect(query).toContain("status = 'judged'");
    expect(query).toContain("status = 'completed'");
    expect(query).toContain('lease_owner = null');
  });

  it('preserves the hit-rate denominator for NO, IRRELEVANT, and BOTH', async () => {
    for (const verdict of ['NO', 'IRRELEVANT', 'BOTH'] as const) {
      const fake = fakeTransaction(successfulHandler([]));

      await completeQuestion({ actionId, workerId: 'worker-1', verdict, fullyCoveredKeyPointIds: [] }, {
        transaction: fake.transaction,
      });

      const statsUpdate = fake.calls.find((call) => call.toLowerCase().includes('yes_count')) ?? '';
      expect(statsUpdate).toContain('0');
    }
  });

  it('awards zero points when all referenced claims already belong to another message', async () => {
    const fake = fakeTransaction(successfulHandler([]));

    await completeQuestion({ actionId, workerId: 'worker-1', verdict: 'BOTH', fullyCoveredKeyPointIds: [keyPointOne] }, {
      transaction: fake.transaction,
    });

    expect(fake.calls.find((call) => call.toLowerCase().includes('awarded_points'))?.toLowerCase()).toContain('awarded_points = 0');
    expect(fake.calls.join('\n').toLowerCase()).toContain('discovered_key_point_count = discovered_key_point_count + 0');
  });

  it.each([
    ['wrong owner', { leaseOwner: 'worker-2' }],
    ['expired lease', { leaseExpiresAt: '2020-01-01T00:00:00.000Z' }],
    ['ended game', { gameStatus: 'ENDED' }],
  ])('commits nothing for %s', async (_label, override) => {
    const leaseOwner = 'leaseOwner' in override ? override.leaseOwner : undefined;
    const leaseExpiresAt = 'leaseExpiresAt' in override ? override.leaseExpiresAt : undefined;
    const gameStatus = 'gameStatus' in override ? override.gameStatus : undefined;
    const currentAction = { ...action, ...(leaseOwner ? { leaseOwner } : {}), ...(leaseExpiresAt ? { leaseExpiresAt } : {}) };
    const fake = fakeTransaction((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('from private.game_actions')) return [currentAction];
      if (normalized.includes('from api.games')) return [{ id: gameId, status: gameStatus ?? 'ACTIVE' }];
      return [];
    });

    await completeQuestion({ actionId, workerId: 'worker-1', verdict: 'YES', fullyCoveredKeyPointIds: [keyPointOne] }, {
      transaction: fake.transaction,
      now: new Date('2026-08-15T00:00:00.000Z'),
    });

    expect(fake.calls.filter((call) => call.toLowerCase().includes('insert into')).length).toBe(0);
  });

  it('rejects an unknown or cross-game key point before any write', async () => {
    const fake = fakeTransaction((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('from private.game_actions')) return [action];
      if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
      if (normalized.includes('from api.messages')) return [{ id: messageId, gameId, playerId, status: 'PENDING' }];
      if (normalized.includes('from private.key_points')) return [];
      return [];
    });

    await expect(completeQuestion({ actionId, workerId: 'worker-1', verdict: 'YES', fullyCoveredKeyPointIds: [keyPointOne] }, {
      transaction: fake.transaction,
    })).rejects.toThrow('UNKNOWN_KEY_POINT_ID');
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('insert into private.key_point_claims');
  });

  it('is idempotent when the action was already completed', async () => {
    const fake = fakeTransaction((query) => query.toLowerCase().includes('from private.game_actions')
      ? [{ ...action, status: 'COMPLETED', leaseOwner: null, leaseExpiresAt: null }]
      : []);

    await completeQuestion({ actionId, workerId: 'worker-1', verdict: 'YES', fullyCoveredKeyPointIds: [keyPointOne] }, {
      transaction: fake.transaction,
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].toLowerCase()).not.toContain('insert into');
  });
});
