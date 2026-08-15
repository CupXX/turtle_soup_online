import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { IdempotencyConflictError } from '@/server/security/idempotency';
import {
  ChallengeInProgressError,
  ChallengeMessageNotFoundError,
  submitChallenge,
} from './submit-challenge';

const gameId = '00000000-0000-4000-8000-000000000001';
const playerId = '00000000-0000-4000-8000-000000000002';
const messageId = '00000000-0000-4000-8000-000000000003';
const idempotencyKey = '00000000-0000-4000-8000-000000000004';
const challengeId = '00000000-0000-4000-8000-000000000005';

function fakeRunner(handler: (query: string) => unknown[]) {
  const calls: string[] = [];
  const transaction = async <T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> => {
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
      calls.push(query);
      return Promise.resolve(handler(query)) as never;
    }) as unknown as TransactionSql;
    return callback(sql);
  };
  return { calls, transaction };
}

function readyHandler(query: string): unknown[] {
  const normalized = query.toLowerCase();
  if (normalized.includes('private.worker_heartbeats')) return [{ lastSeenAt: new Date().toISOString() }];
  if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
  if (normalized.includes('coalesce(max')) return [{ sequenceNo: 8 }];
  if (normalized.includes('from private.game_actions')) return [];
  if (normalized.includes('count(*)')) return [{ missingCount: 0 }];
  if (normalized.includes('from api.messages')) return [{ id: messageId, gameId, playerId: '00000000-0000-4000-8000-000000000006', status: 'JUDGED', verdict: 'YES', challengeStatus: 'NONE' }];
  if (normalized.includes('from private.question_judgments')) return [{ messageId, promptVersion: 'question-judge-v6', schemaVersion: 'judge-schema-v1' }];
  if (normalized.includes('from private.message_challenges')) return [{ id: challengeId, messageId, status: 'PENDING' }];
  return [];
}

describe('submitChallenge', () => {
  it('queues a challenge after a complete v6 judgment and marks the public status pending', async () => {
    const fake = fakeRunner(readyHandler);
    const result = await submitChallenge({ playerId, messageId, idempotencyKey, payloadDigest: 'digest' }, {
      transaction: fake.transaction,
      idFactory: (() => {
        let next = 5;
        return () => `00000000-0000-4000-8000-00000000000${next++}`;
      })(),
    });

    expect(result).toEqual({ challengeId, messageId, status: 'PENDING' });
    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain("insert into private.message_challenges");
    expect(query).toContain("challenge_status = 'pending'");
    expect(query).toContain("'challenge'");
    expect(fake.calls.findIndex((call) => call.toLowerCase().includes('insert into private.message_challenges')))
      .toBeLessThan(fake.calls.findIndex((call) => call.toLowerCase().includes("action_type, status")));
  });

  it('rejects an already pending challenge', async () => {
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('private.worker_heartbeats')) return [{ lastSeenAt: new Date().toISOString() }];
      if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
      if (normalized.includes('from private.game_actions')) return [];
      if (normalized.includes('from api.messages')) return [{ id: messageId, status: 'JUDGED', verdict: 'YES', challengeStatus: 'PENDING' }];
      return [];
    });

    await expect(submitChallenge({ playerId, messageId, idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(ChallengeInProgressError);
  });

  it('rejects a judged message with no complete v6 judgment', async () => {
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('private.worker_heartbeats')) return [{ lastSeenAt: new Date().toISOString() }];
      if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
      if (normalized.includes('from private.game_actions')) return [];
      if (normalized.includes('from api.messages')) return [{ id: messageId, status: 'JUDGED', verdict: 'YES', challengeStatus: 'NONE' }];
      if (normalized.includes('from private.question_judgments')) return [];
      return [];
    });

    await expect(submitChallenge({ playerId, messageId, idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(ChallengeMessageNotFoundError);
  });

  it('keeps idempotency conflicts before any new write', async () => {
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('private.worker_heartbeats')) return [{ lastSeenAt: new Date().toISOString() }];
      if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
      if (normalized.includes('from private.game_actions')) return [{ payloadDigest: 'different', resultResourceId: challengeId }];
      return [];
    });

    await expect(submitChallenge({ playerId, messageId, idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('insert into private.message_challenges');
  });

  it('rejects a game containing judged messages without complete v6 coverage', async () => {
    const fake = fakeRunner((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('private.worker_heartbeats')) return [{ lastSeenAt: new Date().toISOString() }];
      if (normalized.includes('from api.games')) return [{ id: gameId, status: 'ACTIVE' }];
      if (normalized.includes('from private.game_actions')) return [];
      if (normalized.includes('count(*)')) return [{ missingCount: 1 }];
      if (normalized.includes('from api.messages')) return [{ id: messageId, status: 'JUDGED', verdict: 'YES', challengeStatus: 'NONE' }];
      if (normalized.includes('from private.question_judgments')) return [{ messageId, promptVersion: 'question-judge-v6', schemaVersion: 'judge-schema-v1' }];
      return [];
    });

    await expect(submitChallenge({ playerId, messageId, idempotencyKey, payloadDigest: 'digest' }, { transaction: fake.transaction }))
      .rejects.toBeInstanceOf(ChallengeMessageNotFoundError);
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('insert into private.message_challenges');
  });
});
