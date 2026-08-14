import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  GameAlreadyOpenError,
  GameLifecycleStateError,
  InputVersionConflictError,
  WorkerUnavailableError,
  activateGame,
  createPreparation,
  replacePreparation,
  retryExtraction,
} from './admin-lifecycle.js';

function fakeRunner(handler: (query: string) => unknown[] = () => []) {
  const calls: string[] = [];
  const transaction = async <T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> => {
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
      calls.push(query);
      const rows = handler(query);
      if (rows.length > 0) return Promise.resolve(rows);
      if (query.toLowerCase().includes('private.worker_heartbeats')) {
        return Promise.resolve([{ lastSeenAt: new Date().toISOString() }]);
      }
      return Promise.resolve(rows);
    }) as unknown as TransactionSql;
    return callback(sql);
  };
  return { transaction, calls };
}

describe('admin lifecycle', () => {
  it('creates a WAITING game, private secret row, and one extraction job without returning secrets', async () => {
    const fake = fakeRunner();
    const result = await createPreparation({ puzzleSurface: '公开题面', fullSolution: '完整答案' }, {
      transaction: fake.transaction,
      idFactory: () => '00000000-0000-4000-8000-000000000001',
    });

    expect(result).toEqual({ gameId: '00000000-0000-4000-8000-000000000001', status: 'WAITING' });
    expect(result).not.toHaveProperty('fullSolution');
    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain('private.game_secrets');
    expect(query).toContain('private.key_point_extraction_jobs');
    expect(query).toContain("'waiting'");
  });

  it('rejects creation when an open game already exists', async () => {
    const fake = fakeRunner((query) => query.toLowerCase().includes('from api.games') ? [{ id: 'existing-game' }] : []);

    await expect(createPreparation({ puzzleSurface: '题面', fullSolution: '答案' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(GameAlreadyOpenError);
    expect(fake.calls.filter((call) => call.toLowerCase().includes('private.game_secrets'))).toHaveLength(0);
  });

  it('rejects extraction-triggering writes when the worker heartbeat is stale', async () => {
    const fake = fakeRunner((query) => query.toLowerCase().includes('private.worker_heartbeats')
      ? [{ lastSeenAt: new Date(Date.now() - 31_000).toISOString() }]
      : []);

    await expect(createPreparation({ puzzleSurface: '棰橀潰', fullSolution: '绛旀' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(WorkerUnavailableError);
  });

  it('increments the private input version when replacing a WAITING preparation', async () => {
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('select status') && normalized.includes('api.games')) return [{ status: 'WAITING' }];
      if (normalized.includes('input_version')) return [{ inputVersion: 1 }];
      return [];
    });

    await replacePreparation('00000000-0000-4000-8000-000000000001', { puzzleSurface: '新题面', fullSolution: '新答案' }, { transaction: fake.transaction });

    expect(fake.calls.join('\n')).toContain('input_version');
    expect(fake.calls.join('\n')).toContain('2');
  });

  it('requires exactly three to five unique key points before activation', async () => {
    const fake = fakeRunner((query) => query.toLowerCase().includes('from api.games') ? [{ status: 'WAITING', puzzleSurface: '题面', inputVersion: 1 }] : []);

    await expect(activateGame({ gameId: '00000000-0000-4000-8000-000000000001', inputVersion: 1, keyPoints: [{ content: '只有一条' }, { content: '第二条' }] }, { transaction: fake.transaction }))
      .rejects.toThrow('three to five');
    expect(fake.calls).toHaveLength(0);
  });

  it('activates a matching WAITING version and refuses an already ACTIVE game', async () => {
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('from api.games')) return [{ status: 'WAITING', puzzleSurface: '题面', inputVersion: 2 }];
      return [];
    });
    await activateGame({ gameId: '00000000-0000-4000-8000-000000000001', inputVersion: 2, keyPoints: [{ content: '线索一' }, { content: '线索二' }, { content: '线索三' }] }, { transaction: fake.transaction, idFactory: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}`; })() });
    expect(fake.calls.join('\n').toLowerCase()).toContain("status = 'active'");

    const active = fakeRunner((query) => query.toLowerCase().includes('from api.games') ? [{ status: 'ACTIVE', puzzleSurface: '题面', inputVersion: 2 }] : []);
    await expect(activateGame({ gameId: '00000000-0000-4000-8000-000000000001', inputVersion: 2, keyPoints: [{ content: '一' }, { content: '二' }, { content: '三' }] }, { transaction: active.transaction }))
      .rejects.toBeInstanceOf(GameLifecycleStateError);
  });

  it('rejects activation when the submitted version is stale', async () => {
    const fake = fakeRunner((query) => query.toLowerCase().includes('from api.games') ? [{ status: 'WAITING', puzzleSurface: '题面', inputVersion: 2 }] : []);

    await expect(activateGame({ gameId: '00000000-0000-4000-8000-000000000001', inputVersion: 1, keyPoints: [{ content: '一' }, { content: '二' }, { content: '三' }] }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(InputVersionConflictError);
  });

  it('retries only the blocked extraction job and does not return stored text', async () => {
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('from private.game_secrets')) return [{ inputVersion: 3 }];
      if (normalized.includes('from private.key_point_extraction_jobs')) return [{ status: 'BLOCKED' }];
      return [];
    });

    const result = await retryExtraction('00000000-0000-4000-8000-000000000001', { transaction: fake.transaction });

    expect(result).toBeUndefined();
    expect(fake.calls.join('\n').toLowerCase()).toContain("status = 'retry'");
  });
});
