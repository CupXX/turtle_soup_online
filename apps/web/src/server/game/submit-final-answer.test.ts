import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { IdempotencyConflictError } from '@/server/security/idempotency';
import { GameNotActiveError, WorkerUnavailableError, submitFinalAnswer } from './submit-final-answer.js';

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

describe('submitFinalAnswer', () => {
  it('stores only a private receipt and allocates the next shared action sequence', async () => {
    const fake = fakeRunner(freshHandler);
    const result = await submitFinalAnswer({
      playerId,
      answer: '  The hidden answer is that the signal was a diversion. ',
      idempotencyKey,
      payloadDigest: 'digest',
    }, {
      transaction: fake.transaction,
      idFactory: (() => {
        let next = 4;
        return () => `00000000-0000-4000-8000-00000000000${next++}`;
      })(),
    });

    expect(result).toEqual({
      submissionId: '00000000-0000-4000-8000-000000000004',
      gameId,
      playerId,
      sequenceNo: 5,
      status: 'PENDING',
    });
    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain('private.final_answer_submissions');
    expect(query).toContain("'final_answer'");
    expect(query).not.toContain('api.messages');
    expect(query).not.toContain('select answer');
  });

  it('replays the same safe receipt without inserting a second answer', async () => {
    const submissionId = '00000000-0000-4000-8000-000000000004';
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('private.worker_heartbeats')) return [{ lastSeenAt: new Date().toISOString() }];
      if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
      if (normalized.includes('from private.game_actions')) return [{ payloadDigest: 'digest', resultResourceId: submissionId, sequenceNo: 5 }];
      return [];
    });

    await expect(submitFinalAnswer({ playerId, answer: 'answer', idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .resolves.toEqual({ submissionId, gameId, playerId, sequenceNo: 5, status: 'PENDING' });
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('insert into private.final_answer_submissions');
  });

  it('rejects an idempotency payload conflict before writing', async () => {
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('private.worker_heartbeats')) return [{ lastSeenAt: new Date().toISOString() }];
      if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
      if (normalized.includes('from private.game_actions')) return [{ payloadDigest: 'other', resultResourceId: '00000000-0000-4000-8000-000000000004', sequenceNo: 5 }];
      return [];
    });

    await expect(submitFinalAnswer({ playerId, answer: 'answer', idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('insert into private.final_answer_submissions');
  });

  it('rejects malformed identifiers before starting the transaction', async () => {
    const fake = fakeRunner();
    await expect(submitFinalAnswer({ playerId, answer: 'answer', idempotencyKey: 'bad', payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it.each([
    ['WAITING', GameNotActiveError],
    ['ENDED', GameNotActiveError],
  ] as const)('rejects a %s game without persisting the answer', async (status, errorType) => {
    const fake = fakeRunner((query) => query.toLowerCase().includes('private.worker_heartbeats')
      ? [{ lastSeenAt: new Date().toISOString() }]
      : query.toLowerCase().includes('from api.games')
        ? [{ id: gameId, status }]
        : []);

    await expect(submitFinalAnswer({ playerId, answer: 'answer', idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(errorType);
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('insert into private.final_answer_submissions');
  });

  it('rejects a stale or missing Worker heartbeat', async () => {
    const fake = fakeRunner((query) => query.toLowerCase().includes('private.worker_heartbeats')
      ? [{ lastSeenAt: new Date(Date.now() - 31_000).toISOString() }]
      : []);

    await expect(submitFinalAnswer({ playerId, answer: 'answer', idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(WorkerUnavailableError);
  });
});

