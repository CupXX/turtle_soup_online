import { createHmac } from 'node:crypto';
import { getDb } from '@/server/db/client';
import { getServerEnv } from '@/server/env';
import { requireUuid } from './input';

export type IdempotencyInput = {
  actorScope: string;
  operation: string;
  key: string;
  payload: unknown;
};

export type IdempotencyClaim =
  | { kind: 'NEW' }
  | { kind: 'REPLAY'; resultResourceId: string; responseStatus: number };

export type IdempotencyRecord = {
  payloadDigest: string;
  resultResourceId: string;
  responseStatus: number;
};

export type IdempotencyStore = {
  find(input: Pick<IdempotencyInput, 'actorScope' | 'operation' | 'key'>): Promise<IdempotencyRecord | null>;
  insert(input: {
    actorScope: string;
    operation: string;
    key: string;
    payloadDigest: string;
    resultResourceId: string;
    responseStatus: number;
  }): Promise<IdempotencyRecord>;
};

export class IdempotencyConflictError extends Error {
  constructor() {
    super('IDEMPOTENCY_CONFLICT');
    this.name = 'IdempotencyConflictError';
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Payload contains a non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  throw new TypeError('Payload contains an unsupported value');
}

export function computePayloadDigest(payload: unknown, secret: string): string {
  return createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex');
}

const databaseStore: IdempotencyStore = {
  async find(input) {
    const rows = await getDb()<IdempotencyRecord[]>`
      select payload_digest as "payloadDigest",
             coalesce(result_resource_id::text, '') as "resultResourceId",
             response_status as "responseStatus"
      from private.request_idempotency
      where actor_scope = ${input.actorScope}
        and operation = ${input.operation}
        and idempotency_key = ${input.key}::uuid
      limit 1
    `;
    return rows[0] ?? null;
  },
  async insert(input) {
    const rows = await getDb()<IdempotencyRecord[]>`
      insert into private.request_idempotency
        (actor_scope, operation, idempotency_key, payload_digest, result_resource_id, response_status)
      values
        (${input.actorScope}, ${input.operation}, ${input.key}::uuid, ${input.payloadDigest},
         nullif(${input.resultResourceId}, '')::uuid, ${input.responseStatus})
      on conflict (actor_scope, operation, idempotency_key) do update
        set updated_at = private.request_idempotency.updated_at
      returning payload_digest as "payloadDigest",
                coalesce(result_resource_id::text, '') as "resultResourceId",
                response_status as "responseStatus"
    `;
    return rows[0] ?? {
      payloadDigest: input.payloadDigest,
      resultResourceId: input.resultResourceId,
      responseStatus: input.responseStatus,
    };
  },
};

type IdempotencyDependencies = {
  secret?: string;
  store?: IdempotencyStore;
  resultResourceId?: string;
  responseStatus?: number;
};

export async function claimIdempotency(
  input: IdempotencyInput,
  dependencies: IdempotencyDependencies = {},
): Promise<IdempotencyClaim> {
  requireUuid(input.key, 'Idempotency-Key');
  const secret = dependencies.secret ?? getServerEnv().idempotencyHmacSecret;
  const store = dependencies.store ?? databaseStore;
  const payloadDigest = computePayloadDigest(input.payload, secret);
  const existing = await store.find(input);

  if (existing) {
    if (existing.payloadDigest !== payloadDigest) {
      throw new IdempotencyConflictError();
    }
    return {
      kind: 'REPLAY',
      resultResourceId: existing.resultResourceId,
      responseStatus: existing.responseStatus,
    };
  }

  await store.insert({
    actorScope: input.actorScope,
    operation: input.operation,
    key: input.key,
    payloadDigest,
    resultResourceId: dependencies.resultResourceId ?? '',
    responseStatus: dependencies.responseStatus ?? 202,
  });
  return { kind: 'NEW' };
}
