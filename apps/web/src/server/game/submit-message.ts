import { randomUUID } from 'node:crypto';
import type { PublicMessage } from '@turtle-soup/contracts';
import type { Sql, TransactionSql } from 'postgres';
import { getDb, withWebTransaction } from '@/server/db/client';
import { IdempotencyConflictError } from '@/server/security/idempotency';
import { normalizeBoundedText, requireUuid } from '@/server/security/input';

export type SubmitMessageInput = {
  playerId: string;
  content: string;
  idempotencyKey: string;
  payloadDigest: string;
};

export type SubmitMessageDependencies = {
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

class MessageReceiptNotFoundError extends Error {
  constructor() {
    super('MESSAGE_RECEIPT_NOT_FOUND');
    this.name = 'MessageReceiptNotFoundError';
  }
}

type HeartbeatRow = { lastSeenAt: string };
type GameRow = { id: string; status: string };
type ActionRow = { payloadDigest: string; resultResourceId: string | null };
type SequenceRow = { sequenceNo: number | string };
type PublicMessageRow = {
  id: string;
  gameId: string;
  playerId: string;
  sequenceNo: number | string;
  content: string;
  status: PublicMessage['status'];
  verdict: PublicMessage['verdict'];
  awardedPoints: number;
  createdAt: string;
  judgedAt: string | null;
  updatedAt: string;
};

function transactionFor(dependencies: SubmitMessageDependencies) {
  return dependencies.transaction ?? withWebTransaction;
}

function idFactoryFor(dependencies: SubmitMessageDependencies): () => string {
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

function publicMessage(row: PublicMessageRow): PublicMessage {
  return {
    id: row.id,
    gameId: row.gameId,
    playerId: row.playerId,
    sequenceNo: Number(row.sequenceNo),
    content: row.content,
    status: row.status,
    verdict: row.verdict,
    awardedPoints: Number(row.awardedPoints),
    createdAt: row.createdAt,
    judgedAt: row.judgedAt,
    updatedAt: row.updatedAt,
  };
}

function selectPublicMessage(sql: TransactionSql | Sql, messageId: string) {
  return sql<PublicMessageRow[]>`
    select
      id,
      game_id as "gameId",
      player_id as "playerId",
      sequence_no as "sequenceNo",
      content,
      status,
      verdict,
      awarded_points as "awardedPoints",
      created_at as "createdAt",
      judged_at as "judgedAt",
      updated_at as "updatedAt"
    from api.messages
    where id = ${messageId}
    limit 1
  `;
}

export async function getPublicMessageById(messageId: string, dependencies: { sql?: Sql } = {}): Promise<PublicMessage | null> {
  const validMessageId = requireUuid(messageId, 'messageId');
  const rows = await selectPublicMessage(dependencies.sql ?? getDb(), validMessageId);
  return rows[0] ? publicMessage(rows[0]) : null;
}

export async function submitMessage(
  input: SubmitMessageInput,
  dependencies: SubmitMessageDependencies = {},
): Promise<PublicMessage> {
  const playerId = requireUuid(input.playerId, 'playerId');
  const idempotencyKey = requireUuid(input.idempotencyKey, 'Idempotency-Key');
  const content = normalizeBoundedText(input.content, 500, 'content');
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
        result_resource_id::text as "resultResourceId"
      from private.game_actions
      where game_id = ${game.id}
        and player_id = ${playerId}
        and action_type = 'NORMAL_MESSAGE'
        and idempotency_key = ${idempotencyKey}::uuid
      for update
    `;
    if (existing[0]) {
      if (existing[0].payloadDigest !== input.payloadDigest) {
        throw new IdempotencyConflictError();
      }
      if (!existing[0].resultResourceId) throw new MessageReceiptNotFoundError();
      const rows = await selectPublicMessage(sql, existing[0].resultResourceId);
      if (!rows[0]) throw new MessageReceiptNotFoundError();
      return publicMessage(rows[0]);
    }

    const sequenceRows = await sql<SequenceRow[]>`
      select coalesce(max(sequence_no), 0) as "sequenceNo"
      from private.game_actions
      where game_id = ${game.id}
    `;
    const sequenceNo = Number(sequenceRows[0]?.sequenceNo ?? 0) + 1;
    const messageId = makeId();
    const actionId = makeId();

    await sql`
      insert into api.messages
        (id, game_id, player_id, sequence_no, content, status, verdict,
         awarded_points, created_at, judged_at, updated_at)
      values
        (${messageId}, ${game.id}, ${playerId}, ${sequenceNo}, ${content}, 'PENDING', null,
         0, now(), null, now())
    `;
    await sql`
      insert into private.game_actions
        (id, game_id, player_id, sequence_no, action_type, status,
         attempt_count, next_attempt_at, lease_owner, lease_expires_at,
         idempotency_key, payload_digest, result_resource_id, error_code,
         created_at, updated_at)
      values
        (${actionId}, ${game.id}, ${playerId}, ${sequenceNo}, 'NORMAL_MESSAGE', 'PENDING',
         0, now(), null, null, ${idempotencyKey}::uuid, ${input.payloadDigest}, ${messageId}::uuid, null,
         now(), now())
    `;
    await sql`
      update api.games
      set total_question_count = total_question_count + 1,
          updated_at = now()
      where id = ${game.id} and status = 'ACTIVE'
    `;
    await sql`
      insert into api.game_player_stats
        (game_id, player_id, question_count, yes_count, updated_at)
      values (${game.id}, ${playerId}, 1, 0, now())
      on conflict (game_id, player_id) do update
        set question_count = api.game_player_stats.question_count + 1,
            updated_at = now()
    `;

    const rows = await selectPublicMessage(sql, messageId);
    if (rows[0]) return publicMessage(rows[0]);
    const timestamp = now.toISOString();
    return {
      id: messageId,
      gameId: game.id,
      playerId,
      sequenceNo,
      content,
      status: 'PENDING',
      verdict: null,
      awardedPoints: 0,
      createdAt: timestamp,
      judgedAt: null,
      updatedAt: timestamp,
    };
  });
}
