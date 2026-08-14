import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { getDb, withWebTransaction } from '@/server/db/client';
import { IdempotencyConflictError } from '@/server/security/idempotency';
import { normalizeBoundedText, requireUuid } from '@/server/security/input';

export type FinalAnswerReceipt = {
  submissionId: string;
  gameId: string;
  playerId: string;
  sequenceNo: number;
  status: 'PENDING';
};

export type SubmitFinalAnswerInput = {
  playerId: string;
  answer: string;
  idempotencyKey: string;
  payloadDigest: string;
};

export type SubmitFinalAnswerDependencies = {
  transaction?: <T>(callback: (sql: TransactionSql) => Promise<T>) => Promise<T>;
  idFactory?: () => string;
  now?: Date;
};

export class GameNotActiveError extends Error {
  constructor() {
    super('GAME_NOT_ACTIVE');
    this.name = 'GameNotActiveError';
  }
}

export class WorkerUnavailableError extends Error {
  constructor() {
    super('JUDGE_UNAVAILABLE');
    this.name = 'WorkerUnavailableError';
  }
}

class FinalAnswerReceiptNotFoundError extends Error {
  constructor() {
    super('FINAL_ANSWER_RECEIPT_NOT_FOUND');
    this.name = 'FinalAnswerReceiptNotFoundError';
  }
}

type HeartbeatRow = { lastSeenAt: string };
type GameRow = { id: string; status: string };
type ActionRow = { payloadDigest: string; resultResourceId: string | null; sequenceNo: number | string };

function transactionFor(dependencies: SubmitFinalAnswerDependencies) {
  return dependencies.transaction ?? withWebTransaction;
}

function idFactoryFor(dependencies: SubmitFinalAnswerDependencies): () => string {
  return dependencies.idFactory ?? randomUUID;
}

function isWorkerHealthy(lastSeenAt: string | null | undefined, now: Date): boolean {
  const timestamp = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  return timestamp > 0 && now.getTime() - timestamp <= 30_000;
}

async function requireFreshWorker(sql: TransactionSql, now: Date): Promise<void> {
  const rows = await sql<HeartbeatRow[]>`
    select last_seen_at as "lastSeenAt"
    from private.worker_heartbeats
    order by last_seen_at desc
    limit 1
  `;
  if (!isWorkerHealthy(rows[0]?.lastSeenAt, now)) {
    throw new WorkerUnavailableError();
  }
}

function receipt(submissionId: string, gameId: string, playerId: string, sequenceNo: number | string): FinalAnswerReceipt {
  return {
    submissionId,
    gameId,
    playerId,
    sequenceNo: Number(sequenceNo),
    status: 'PENDING',
  };
}

export async function getFinalAnswerReceiptById(
  submissionId: string,
  dependencies: { sql?: Sql } = {},
): Promise<FinalAnswerReceipt | null> {
  const validSubmissionId = requireUuid(submissionId, 'submissionId');
  const rows = await (dependencies.sql ?? getDb())<Array<{ id: string; gameId: string; playerId: string; sequenceNo: number | string }>>`
    select
      id,
      game_id as "gameId",
      player_id as "playerId",
      sequence_no as "sequenceNo"
    from private.game_actions
    where id = ${validSubmissionId}
      and action_type = 'FINAL_ANSWER'
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return receipt(row.id, row.gameId, row.playerId, row.sequenceNo);
}

export async function submitFinalAnswer(
  input: SubmitFinalAnswerInput,
  dependencies: SubmitFinalAnswerDependencies = {},
): Promise<FinalAnswerReceipt> {
  const playerId = requireUuid(input.playerId, 'playerId');
  const idempotencyKey = requireUuid(input.idempotencyKey, 'Idempotency-Key');
  const answer = normalizeBoundedText(input.answer, 4000, 'answer');
  if (!input.payloadDigest.trim()) throw new Error('payloadDigest is required');

  const makeId = idFactoryFor(dependencies);
  const now = dependencies.now ?? new Date();

  return transactionFor(dependencies)(async (sql) => {
    await requireFreshWorker(sql, now);

    const games = await sql<GameRow[]>`
      select id, status
      from api.games
      where status in ('WAITING', 'ACTIVE', 'ENDED')
      order by case when status in ('WAITING', 'ACTIVE') then 0 else 1 end,
               coalesce(ended_at, updated_at) desc
      limit 1
      for update
    `;
    const game = games[0];
    if (!game || game.status !== 'ACTIVE') throw new GameNotActiveError();

    const existing = await sql<ActionRow[]>`
      select
        payload_digest as "payloadDigest",
        result_resource_id::text as "resultResourceId",
        sequence_no as "sequenceNo"
      from private.game_actions
      where game_id = ${game.id}
        and player_id = ${playerId}
        and action_type = 'FINAL_ANSWER'
        and idempotency_key = ${idempotencyKey}::uuid
    `;
    if (existing[0]) {
      if (existing[0].payloadDigest !== input.payloadDigest) {
        throw new IdempotencyConflictError();
      }
      if (!existing[0].resultResourceId) throw new FinalAnswerReceiptNotFoundError();
      return receipt(existing[0].resultResourceId, game.id, playerId, existing[0].sequenceNo);
    }

    const sequenceRows = await sql<Array<{ sequenceNo: number | string }>>`
      select coalesce(max(sequence_no), 0) as "sequenceNo"
      from private.game_actions
      where game_id = ${game.id}
    `;
    const sequenceNo = Number(sequenceRows[0]?.sequenceNo ?? 0) + 1;
    const submissionId = makeId();

    await sql`
      insert into private.game_actions
        (id, game_id, player_id, sequence_no, action_type, status,
         attempt_count, next_attempt_at, lease_owner, lease_expires_at,
         idempotency_key, payload_digest, result_resource_id, error_code,
         created_at, updated_at)
      values
        (${submissionId}, ${game.id}, ${playerId}, ${sequenceNo}, 'FINAL_ANSWER', 'PENDING',
         0, now(), null, null, ${idempotencyKey}::uuid, ${input.payloadDigest}, ${submissionId}::uuid, null,
         now(), now())
    `;
    await sql`
      insert into private.final_answer_submissions
        (id, action_id, game_id, player_id, answer, covered_key_point_ids,
         status, created_at, judged_at)
      values
        (${submissionId}, ${submissionId}, ${game.id}, ${playerId}, ${answer}, '{}', 'PENDING', now(), null)
    `;

    return receipt(submissionId, game.id, playerId, sequenceNo);
  });
}
