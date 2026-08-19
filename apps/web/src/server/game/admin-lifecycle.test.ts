import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  GameAlreadyOpenError,
  GameLifecycleStateError,
  InputVersionConflictError,
  WorkerUnavailableError,
  activateGame,
  createPreparation,
  forceEndGame,
  getAdminStatus,
  replacePreparation,
  retryBlockedAction,
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
      idFactory: (() => {
        let next = 1;
        return () => `00000000-0000-4000-8000-00000000000${next++}`;
      })(),
    });

    expect(result).toEqual({ gameId: '00000000-0000-4000-8000-000000000001', status: 'WAITING' });
    expect(result).not.toHaveProperty('fullSolution');
    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain('private.game_secrets');
    expect(query).toContain('private.key_point_extraction_jobs');
    expect(fake.calls.find((call) => call.toLowerCase().includes('private.key_point_extraction_jobs'))).toContain('00000000-0000-4000-8000-000000000002');
    expect(query).toContain("'waiting'");
  });

  it('returns ordered extracted key points to the authenticated admin status boundary only', async () => {
    const calls: string[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
      calls.push(query);
      const normalized = query.toLowerCase();
      if (normalized.includes('from api.games')) return Promise.resolve([{ id: 'game-1', gameStatus: 'ACTIVE' }]);
      if (normalized.includes('from private.key_points')) return Promise.resolve([
        { ordinal: 1, content: '被蚊子叮醒' },
        { ordinal: 2, content: '打蚊子但没打中' },
        { ordinal: 3, content: '点燃蚊香' },
      ]);
      if (normalized.includes('private.worker_heartbeats')) return Promise.resolve([{ lastSeenAt: new Date().toISOString() }]);
      return Promise.resolve([]);
    }) as never;

    const status = await getAdminStatus(sql);

    expect(status).toMatchObject({
      gameId: 'game-1',
      keyPoints: [
        { ordinal: 1, content: '被蚊子叮醒' },
        { ordinal: 2, content: '打蚊子但没打中' },
        { ordinal: 3, content: '点燃蚊香' },
      ],
    });
    expect(status).not.toHaveProperty('fullSolution');
    expect(calls.join('\n')).not.toContain('judge_attempts');
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
    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain("status = 'retry'");
    expect(query).toContain('attempt_count = 0');
  });

  it('returns a blocked action head to RETRY without exposing its private payload', async () => {
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('from api.games')) return [{ id: '00000000-0000-4000-8000-000000000001', status: 'ACTIVE' }];
      if (normalized.includes('private.game_actions')) return [{ id: '00000000-0000-4000-8000-000000000002', status: 'BLOCKED' }];
      return [];
    });

    await retryBlockedAction('00000000-0000-4000-8000-000000000001', { transaction: fake.transaction });

    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain("status = 'retry'");
    expect(query).toContain('attempt_count = 0');
    expect(query).not.toContain('final_answer_submissions');
    expect(query).not.toContain('answer');
  });

  it('force ends an active game atomically with reveal, event, and cancellation but no score update', async () => {
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('from api.games')) return [{ id: '00000000-0000-4000-8000-000000000001', status: 'ACTIVE' }];
      if (normalized.includes('private.game_secrets')) return [{ fullSolution: 'private solution' }];
      if (normalized.includes('private.key_points')) return [
        { id: '00000000-0000-4000-8000-000000000011', ordinal: 1, content: 'point one' },
        { id: '00000000-0000-4000-8000-000000000012', ordinal: 2, content: 'point two' },
        { id: '00000000-0000-4000-8000-000000000013', ordinal: 3, content: 'point three' },
      ];
      if (normalized.includes('max(sequence_no)')) return [{ sequenceNo: 4 }];
      return [];
    });

    const result = await forceEndGame('00000000-0000-4000-8000-000000000001', {
      transaction: fake.transaction,
      idFactory: () => '00000000-0000-4000-8000-000000000099',
    });

    expect(result).toEqual({ status: 'ENDED', endReason: 'FORCE_ENDED' });
    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain("status = 'ended'");
    expect(query).toContain("end_reason = 'force_ended'");
    expect(query).toContain('event_type, player_id');
    expect(query).toContain("'force_ended'");
    expect(query).toContain('api.game_reveals');
    expect(query).toContain('api.revealed_key_points');
    expect(query).toContain("status = 'cancelled'");
    expect(query).not.toContain('lifetime_score = lifetime_score +');
  });

  it('does not force end a WAITING or already ended game', async () => {
    for (const status of ['WAITING', 'ENDED']) {
      const fake = fakeRunner((query) => query.toLowerCase().includes('from api.games')
        ? [{ id: '00000000-0000-4000-8000-000000000001', status }]
        : []);
      await expect(forceEndGame('00000000-0000-4000-8000-000000000001', { transaction: fake.transaction }))
        .rejects.toBeInstanceOf(GameLifecycleStateError);
      expect(fake.calls.join('\n').toLowerCase()).not.toContain('insert into api.game_reveals');
    }
  });
});
