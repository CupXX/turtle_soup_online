import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { bindIdempotencyResult, claimIdempotency, computePayloadDigest, type IdempotencyStore } from './idempotency.js';

const key = '00000000-0000-4000-8000-000000000001';

function memoryStore(): IdempotencyStore {
  const records = new Map<string, { payloadDigest: string; resultResourceId: string; responseStatus: number }>();
  return {
    async find(input) {
      return records.get(`${input.actorScope}:${input.operation}:${input.key}`) ?? null;
    },
    async insert(input) {
      const record = {
        payloadDigest: input.payloadDigest,
        resultResourceId: input.resultResourceId,
        responseStatus: input.responseStatus,
      };
      records.set(`${input.actorScope}:${input.operation}:${input.key}`, record);
      return record;
    },
  };
}

describe('idempotency', () => {
  it('uses a stable HMAC digest for equivalent object key order', () => {
    expect(computePayloadDigest({ b: 2, a: 1 }, 'hmac-secret')).toBe(
      computePayloadDigest({ a: 1, b: 2 }, 'hmac-secret'),
    );
    expect(computePayloadDigest({ answer: 'secret' }, 'hmac-secret')).not.toContain('secret');
  });

  it('returns NEW, replays the same body, and rejects a conflicting body', async () => {
    const store = memoryStore();
    const input = {
      actorScope: 'player-1',
      operation: 'MESSAGE',
      key,
      payload: { content: 'hello' },
    };

    await expect(claimIdempotency(input, { secret: 'hmac-secret', store })).resolves.toEqual({ kind: 'NEW' });
    await expect(claimIdempotency(input, { secret: 'hmac-secret', store })).resolves.toEqual({
      kind: 'REPLAY',
      resultResourceId: '',
      responseStatus: 202,
    });
    await expect(
      claimIdempotency({ ...input, payload: { content: 'different' } }, { secret: 'hmac-secret', store }),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
  });

  it('requires a UUID idempotency key', async () => {
    await expect(
      claimIdempotency({ actorScope: 'player-1', operation: 'MESSAGE', key: 'bad', payload: {} }, {
        secret: 'hmac-secret',
        store: memoryStore(),
      }),
    ).rejects.toThrow();
  });

  it('binds the public result to a previously claimed request', async () => {
    const calls: string[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, ''));
      return Promise.resolve([]);
    }) as unknown as Sql;

    await bindIdempotencyResult({
      actorScope: 'player-1',
      operation: 'MESSAGE',
      key,
      resultResourceId: '00000000-0000-4000-8000-000000000002',
      responseStatus: 200,
    }, { sql });

    expect(calls[0].toLowerCase()).toContain('update private.request_idempotency');
    expect(calls[0].toLowerCase()).toContain('result_resource_id');
    expect(calls[0].toLowerCase()).toContain('response_status');
  });
});
