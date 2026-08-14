import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { completeExtraction } from './complete-extraction.js';

type FakeRow = Record<string, unknown>;

function fakeTransaction(results: FakeRow[][]) {
  const calls: string[] = [];
  let started = 0;
  const transaction = async <T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> => {
    started += 1;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce(
        (text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`,
        '',
      );
      calls.push(query);
      return Promise.resolve((results.shift() ?? []) as never);
    }) as unknown as TransactionSql;
    return callback(sql);
  };
  return { calls, transaction, get started() { return started; } };
}

const gameId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';

const baseInput = {
  jobId,
  gameId,
  inputVersion: 1,
  workerId: 'worker-1',
  keyPoints: [{ content: '客人用伞柄敲门' }, { content: '客人从暗门离开' }, { content: '老板误以为房间没人' }],
};

function eligibleRows() {
  return [
    [{ id: jobId, gameId, inputVersion: 1, status: 'PROCESSING', leaseOwner: 'worker-1', leaseExpiresAt: '2099-01-01T00:00:00.000Z' }],
    [{ id: gameId, status: 'WAITING', puzzleSurface: '门外传来敲门声' }],
    [{ gameId, inputVersion: 1, puzzleSurface: '门外传来敲门声' }],
  ];
}

describe('completeExtraction', () => {
  it('atomically stores unique key points, publishes the surface, activates the game, and completes the claimed job', async () => {
    const fake = fakeTransaction(eligibleRows());
    let nextId = 0;

    await completeExtraction(baseInput, {
      transaction: fake.transaction,
      idFactory: () => `00000000-0000-4000-8000-00000000000${++nextId}`,
      now: new Date('2026-08-15T00:00:00.000Z'),
    });

    expect(fake.started).toBe(1);
    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain('for update');
    expect(query).toContain('insert into private.key_points');
    expect(query).toContain("status = 'active'");
    expect(query).toContain('puzzle_surface');
    expect(query).toContain('key_point_total');
    expect(query).toContain("status = 'completed'");
    expect(query).toContain('00000000-0000-4000-8000-000000000003');
  });

  it('normalizes content before enforcing three-to-five unique key points', async () => {
    const fake = fakeTransaction([]);

    await expect(completeExtraction({
      ...baseInput,
      keyPoints: [{ content: '线索' }, { content: ' 线索 ' }, { content: '另一条' }],
    }, { transaction: fake.transaction })).rejects.toThrow('key points must be unique');

    expect(fake.started).toBe(0);
  });

  it.each([
    ['stale input version', { inputVersion: 2 }, [{ id: jobId, gameId, inputVersion: 1, status: 'PROCESSING', leaseOwner: 'worker-1', leaseExpiresAt: '2099-01-01T00:00:00.000Z' }]],
    ['wrong lease owner', { workerId: 'worker-2' }, [{ id: jobId, gameId, inputVersion: 1, status: 'PROCESSING', leaseOwner: 'worker-1', leaseExpiresAt: '2099-01-01T00:00:00.000Z' }]],
    ['lost lease', {}, [{ id: jobId, gameId, inputVersion: 1, status: 'PROCESSING', leaseOwner: 'worker-1', leaseExpiresAt: '2020-01-01T00:00:00.000Z' }]],
    ['repeated completion', {}, [{ id: jobId, gameId, inputVersion: 1, status: 'COMPLETED', leaseOwner: null, leaseExpiresAt: null }]],
  ])('commits nothing for %s', async (_label, overrides, rows) => {
    const fake = fakeTransaction([rows]);

    await completeExtraction({ ...baseInput, ...overrides }, {
      transaction: fake.transaction,
      now: new Date('2026-08-15T00:00:00.000Z'),
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls.join(' ').toLowerCase()).not.toContain('insert into private.key_points');
  });

  it('commits nothing when the game is no longer WAITING', async () => {
    const fake = fakeTransaction([
      eligibleRows()[0],
      [{ id: gameId, status: 'ACTIVE', puzzleSurface: '门外传来敲门声' }],
    ]);

    await completeExtraction(baseInput, { transaction: fake.transaction });

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls.join(' ').toLowerCase()).not.toContain('insert into private.key_points');
  });
});
