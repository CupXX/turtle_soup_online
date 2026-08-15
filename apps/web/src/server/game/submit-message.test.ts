import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { IdempotencyConflictError } from '@/server/security/idempotency';
import { GameNotActiveError, WorkerUnavailableError, submitMessage } from './submit-message.js';

function fakeRunner(handler: (query: string) => unknown[] = () => []) {
  const calls: string[] = [];
  const transaction = async <T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> => {
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
      calls.push(query);
      return Promise.resolve(handler(query));
    }) as unknown as TransactionSql;
    return callback(sql);
  };
  return { calls, transaction };
}

const gameId = '00000000-0000-4000-8000-000000000001';
const playerId = '00000000-0000-4000-8000-000000000002';
const idempotencyKey = '00000000-0000-4000-8000-000000000003';

function freshHandler(query: string): unknown[] {
  const normalized = query.toLowerCase();
  if (normalized.includes('private.worker_heartbeats')) return [{ lastSeenAt: new Date().toISOString() }];
  if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
  if (normalized.includes('coalesce(max')) return [{ sequenceNo: 4 }];
  if (normalized.includes('from private.game_actions')) return [];
  return [];
}

describe('submitMessage', () => {
  it('creates a PENDING public message and private queued action in receipt order', async () => {
    const fake = fakeRunner(freshHandler);
    const result = await submitMessage({
      playerId,
      content: '  Is the door relevant? ',
      idempotencyKey,
      payloadDigest: 'digest',
    }, {
      transaction: fake.transaction,
      idFactory: (() => {
        let next = 4;
        return () => `00000000-0000-4000-8000-00000000000${next++}`;
      })(),
    });

    expect(result).toMatchObject({
      id: '00000000-0000-4000-8000-000000000004',
      gameId,
      playerId,
      sequenceNo: 5,
      content: 'Is the door relevant?',
      status: 'PENDING',
      verdict: null,
      awardedPoints: 0,
    });
    const publicInsert = fake.calls.findIndex((query) => query.toLowerCase().includes('insert into api.messages'));
    const actionInsert = fake.calls.findIndex((query) => query.toLowerCase().includes('insert into private.game_actions'));
    expect(publicInsert).toBeGreaterThanOrEqual(0);
    expect(actionInsert).toBeGreaterThan(publicInsert);
    expect(result.status).toBe('PENDING');
    expect(result.verdict).toBeNull();
    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain("status, verdict");
    expect(query).toContain('private.game_actions');
    expect(query).toContain("'normal_message'");
    expect(query).toContain('total_question_count');
    expect(query).toContain('api.game_player_stats');
    const actionLookup = fake.calls.find((call) => call.toLowerCase().includes('from private.game_actions')) ?? '';
    expect(actionLookup.toLowerCase()).not.toContain('for update');
  });

  it('returns the same public message for a same-key same-payload replay without incrementing counters', async () => {
    const messageId = '00000000-0000-4000-8000-000000000004';
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('private.worker_heartbeats')) return [{ lastSeenAt: new Date().toISOString() }];
      if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
      if (normalized.includes('from private.game_actions')) return [{ payloadDigest: 'digest', resultResourceId: messageId }];
      if (normalized.includes('from api.messages')) return [{
        id: messageId, gameId, playerId, sequenceNo: 5, content: 'question', status: 'PENDING', verdict: null,
        awardedPoints: 0, createdAt: '2026-08-15T00:00:00.000Z', judgedAt: null, updatedAt: '2026-08-15T00:00:00.000Z',
      }];
      return [];
    });

    await expect(submitMessage({ playerId, content: 'question', idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .resolves.toMatchObject({ id: messageId, status: 'PENDING' });
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('insert into api.messages');
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('total_question_count =');
  });

  it('rejects a same-key request with a different payload before writing', async () => {
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('private.worker_heartbeats')) return [{ lastSeenAt: new Date().toISOString() }];
      if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
      if (normalized.includes('from private.game_actions')) return [{ payloadDigest: 'other-digest', resultResourceId: '00000000-0000-4000-8000-000000000004' }];
      return [];
    });

    await expect(submitMessage({ playerId, content: 'question', idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('insert into api.messages');
  });

  it('rejects a malformed idempotency key before starting the transaction', async () => {
    const fake = fakeRunner();
    await expect(submitMessage({ playerId, content: 'question', idempotencyKey: 'bad', payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects a submission when the current game is not active', async () => {
    const fake = fakeRunner((query) => query.toLowerCase().includes('private.worker_heartbeats')
      ? [{ lastSeenAt: new Date().toISOString() }]
      : query.toLowerCase().includes('from api.games')
        ? [{ id: gameId, status: 'WAITING' }]
        : []);

    await expect(submitMessage({ playerId, content: 'question', idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(GameNotActiveError);
  });

  it('rejects persistence when the worker heartbeat is stale', async () => {
    const fake = fakeRunner((query) => query.toLowerCase().includes('private.worker_heartbeats')
      ? [{ lastSeenAt: new Date(Date.now() - 31_000).toISOString() }]
      : []);

    await expect(submitMessage({ playerId, content: 'question', idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(WorkerUnavailableError);
  });

  it('rejects persistence when no worker heartbeat exists', async () => {
    const fake = fakeRunner(() => []);

    await expect(submitMessage({ playerId, content: 'question', idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(WorkerUnavailableError);
  });

  it('rejects an ended game before allocating a sequence', async () => {
    const fake = fakeRunner((query) => query.toLowerCase().includes('private.worker_heartbeats')
      ? [{ lastSeenAt: new Date().toISOString() }]
      : query.toLowerCase().includes('from api.games')
        ? [{ id: gameId, status: 'ENDED' }]
        : []);

    await expect(submitMessage({ playerId, content: 'question', idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(GameNotActiveError);
  });
});
