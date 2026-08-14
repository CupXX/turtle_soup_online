import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { completeFinalAnswer } from './complete-final-answer.js';

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
const keyPointOne = '00000000-0000-4000-8000-000000000011';
const keyPointTwo = '00000000-0000-4000-8000-000000000012';
const keyPointThree = '00000000-0000-4000-8000-000000000013';
const keyPointFour = '00000000-0000-4000-8000-000000000014';

const action = {
  id: actionId,
  gameId,
  playerId,
  actionType: 'FINAL_ANSWER',
  status: 'PROCESSING',
  leaseOwner: 'worker-1',
  leaseExpiresAt: '2099-01-01T00:00:00.000Z',
  resultResourceId: actionId,
  sequenceNo: 7,
};

function handler(overrides: { gameStatus?: string; keyPointIds?: string[]; action?: Record<string, unknown> } = {}): QueryHandler {
  const ids = overrides.keyPointIds ?? [keyPointOne, keyPointTwo, keyPointThree, keyPointFour];
  return (query) => {
    const normalized = query.toLowerCase();
    if (normalized.includes('from private.game_actions')) return [overrides.action ?? action];
    if (normalized.includes('from api.games')) return [{ id: gameId, status: overrides.gameStatus ?? 'ACTIVE' }];
    if (normalized.includes('from private.final_answer_submissions')) return [{ id: actionId, gameId, playerId, status: 'PENDING' }];
    if (normalized.includes('from private.key_points')) return ids.map((id, index) => ({ id, gameId, ordinal: index + 1, content: `point-${index + 1}` }));
    if (normalized.includes('from private.game_secrets')) return [{ fullSolution: 'full solution' }];
    return [];
  };
}

describe('completeFinalAnswer', () => {
  it('ends the game exactly once, awards +2, reveals, and cancels later actions on full coverage', async () => {
    const fake = fakeTransaction(handler());

    await completeFinalAnswer({
      actionId,
      workerId: 'worker-1',
      coveredKeyPointIds: [keyPointFour, keyPointTwo, keyPointOne, keyPointThree],
    }, { transaction: fake.transaction });

    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain("event_type, player_id, awarded_points");
    expect(query).toContain('final_answer_succeeded');
    expect(query).toContain('lifetime_score = lifetime_score + 2');
    expect(query).toContain("status = 'ended'");
    expect(query).toContain("end_reason = 'final_answer_success'");
    expect(query).toContain('api.game_reveals');
    expect(query).toContain('api.revealed_key_points');
    expect(query).toContain("status = 'cancelled'");
    expect(query).toContain("status = 'completed'");
  });

  it('publishes only a failure event for partial coverage and keeps the game active', async () => {
    const fake = fakeTransaction(handler({ keyPointIds: [keyPointOne, keyPointTwo, keyPointThree, keyPointFour] }));

    await completeFinalAnswer({ actionId, workerId: 'worker-1', coveredKeyPointIds: [keyPointOne, keyPointTwo, keyPointThree] }, {
      transaction: fake.transaction,
    });

    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain('final_answer_failed');
    expect(query).not.toContain("end_reason = 'final_answer_success'");
    expect(query).not.toContain('lifetime_score = lifetime_score + 2');
    expect(query).not.toContain('insert into api.game_reveals');
    expect(query).not.toContain("status = 'cancelled'");
  });

  it('rejects an unknown key point before publishing any result', async () => {
    const fake = fakeTransaction(handler({ keyPointIds: [keyPointOne, keyPointTwo, keyPointThree, keyPointFour] }));

    await expect(completeFinalAnswer({ actionId, workerId: 'worker-1', coveredKeyPointIds: ['00000000-0000-4000-8000-000000000099'] }, {
      transaction: fake.transaction,
    })).rejects.toThrow('UNKNOWN_KEY_POINT_ID');
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('insert into api.game_events');
  });

  it.each([
    ['wrong owner', { leaseOwner: 'worker-2' }],
    ['expired lease', { leaseExpiresAt: '2020-01-01T00:00:00.000Z' }],
    ['ended game', { gameStatus: 'ENDED' }],
  ])('commits nothing for %s', async (_label, override) => {
    const value = override as { leaseOwner?: string; leaseExpiresAt?: string; gameStatus?: string };
    const currentAction = { ...action, ...(value.leaseOwner ? { leaseOwner: value.leaseOwner } : {}), ...(value.leaseExpiresAt ? { leaseExpiresAt: value.leaseExpiresAt } : {}) };
    const fake = fakeTransaction(handler({ gameStatus: value.gameStatus, action: currentAction }));

    await completeFinalAnswer({ actionId, workerId: 'worker-1', coveredKeyPointIds: [keyPointOne] }, {
      transaction: fake.transaction,
      now: new Date('2026-08-15T00:00:00.000Z'),
    });

    expect(fake.calls.filter((call) => call.toLowerCase().includes('insert into')).length).toBe(0);
  });

  it('is idempotent when the action was already completed', async () => {
    const fake = fakeTransaction(handler({ action: { ...action, status: 'COMPLETED', leaseOwner: null, leaseExpiresAt: null } }));

    await completeFinalAnswer({ actionId, workerId: 'worker-1', coveredKeyPointIds: [keyPointOne] }, { transaction: fake.transaction });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].toLowerCase()).not.toContain('insert into');
  });

  it('rejects duplicate IDs before opening a transaction', async () => {
    const fake = fakeTransaction(handler());

    await expect(completeFinalAnswer({ actionId, workerId: 'worker-1', coveredKeyPointIds: [keyPointOne, keyPointOne] }, { transaction: fake.transaction }))
      .rejects.toThrow('DUPLICATE_KEY_POINT_ID');
    expect(fake.calls).toHaveLength(0);
  });
});
