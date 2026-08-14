import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  RETRY_SECONDS,
  claimNextAction,
  claimNextExtraction,
  markBlocked,
  recordRetry,
  retryDelaySeconds,
} from './queue.js';

type FakeResult = unknown[];

function fakeTransaction(results: FakeResult[]) {
  const calls: string[] = [];
  const transaction = async <T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> => {
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
      calls.push(query);
      return Promise.resolve((results.shift() ?? []) as never);
    }) as unknown as TransactionSql;
    return callback(sql);
  };
  return { calls, transaction };
}

const gameId = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000002';

describe('durable queue', () => {
  it('uses the documented retry schedule', () => {
    expect(RETRY_SECONDS).toEqual([2, 5, 15]);
    expect(retryDelaySeconds(1)).toBe(2);
    expect(retryDelaySeconds(3)).toBe(15);
    expect(retryDelaySeconds(4)).toBeNull();
  });

  it('claims only the current extraction version and commits a short lease', async () => {
    const fake = fakeTransaction([[{
      id: actionId,
      gameId,
      inputVersion: 2,
      attempt: 0,
    }], [{
      id: actionId,
      gameId,
      inputVersion: 2,
      attempt: 1,
      leaseOwner: 'worker-1',
      leaseExpiresAt: '2026-08-14T14:00:30.000Z',
    }]]);

    await expect(claimNextExtraction('worker-1', new Date('2026-08-14T14:00:00.000Z'), { transaction: fake.transaction }))
      .resolves.toMatchObject({ id: actionId, inputVersion: 2, attempt: 1, leaseOwner: 'worker-1' });

    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain('private.game_secrets');
    expect(query).toContain('for update');
    expect(query).toContain("status = 'processing'");
    expect(query).not.toContain('skip locked');
  });

  it('claims the smallest incomplete action and cannot overtake a blocked or leased head', async () => {
    const fake = fakeTransaction([[{
      id: actionId,
      gameId,
      playerId: '00000000-0000-4000-8000-000000000003',
      sequenceNo: 4,
      actionType: 'NORMAL_MESSAGE',
      attempt: 0,
    }], [{
      id: actionId,
      gameId,
      playerId: '00000000-0000-4000-8000-000000000003',
      sequenceNo: 4,
      actionType: 'NORMAL_MESSAGE',
      attempt: 1,
      leaseOwner: 'worker-2',
      leaseExpiresAt: '2026-08-14T14:01:00.000Z',
    }]]);

    await expect(claimNextAction('worker-2', new Date('2026-08-14T14:00:00.000Z'), { transaction: fake.transaction }))
      .resolves.toMatchObject({ sequenceNo: 4, actionType: 'NORMAL_MESSAGE', attempt: 1 });

    const query = fake.calls[0].toLowerCase();
    expect(query).toContain('not exists');
    expect(query).toContain("status not in ('completed', 'cancelled')");
    expect(query).not.toContain('skip locked');
  });

  it('records retry backoff and clears the previous lease', async () => {
    const fake = fakeTransaction([[]]);

    await expect(recordRetry(actionId, 2, 'TIMEOUT', { transaction: fake.transaction })).resolves.toBeUndefined();

    const query = fake.calls[0].toLowerCase();
    expect(query).toContain("status = 'retry'");
    expect(query).toContain('lease_owner = null');
    expect(query).toContain('error_code');
  });

  it('marks a queue item blocked after the final failed attempt', async () => {
    const fake = fakeTransaction([[]]);

    await expect(markBlocked(actionId, 'SCHEMA_INVALID', { transaction: fake.transaction })).resolves.toBeUndefined();

    expect(fake.calls[0].toLowerCase()).toContain("status = 'blocked'");
    expect(fake.calls[0].toLowerCase()).toContain('lease_expires_at = null');
  });
});
