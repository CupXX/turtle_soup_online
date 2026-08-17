import { randomUUID } from 'node:crypto';
import type { ChallengeReceipt, PublicMessage } from '@turtle-soup/contracts';
import type { Sql, TransactionSql } from 'postgres';
import { getDb, withWebTransaction } from '@/server/db/client';
import { IdempotencyConflictError } from '@/server/security/idempotency';
import { requireUuid } from '@/server/security/input';

export type SubmitChallengeInput = {
  playerId: string;
  messageId: string;
  idempotencyKey: string;
  payloadDigest: string;
};

export type SubmitChallengeDependencies = {
  transaction?: <T>(callback: (sql: TransactionSql) => Promise<T>) => Promise<T>;
  idFactory?: () => string;
  now?: Date;
};

export class ChallengeMessageNotFoundError extends Error {
  constructor() {
    super('MESSAGE_NOT_CHALLENGEABLE');
    this.name = 'ChallengeMessageNotFoundError';
  }
}

export class ChallengeInProgressError extends Error {
  constructor() {
    super('CHALLENGE_IN_PROGRESS');
    this.name = 'ChallengeInProgressError';
  }
}

export class ChallengeAlreadySubmittedError extends Error {
  constructor() {
    super('CHALLENGE_ALREADY_SUBMITTED');
    this.name = 'ChallengeAlreadySubmittedError';
  }
}

export class ChallengeJudgmentUnavailableError extends Error {
  constructor() {
    super('CHALLENGE_UNAVAILABLE');
    this.name = 'ChallengeJudgmentUnavailableError';
  }
}

class ChallengeReceiptNotFoundError extends Error {
  constructor() {
    super('CHALLENGE_RECEIPT_NOT_FOUND');
    this.name = 'ChallengeReceiptNotFoundError';
  }
}

type HeartbeatRow = { lastSeenAt: string };
type GameRow = { id: string; status: string };
type ActionRow = { payloadDigest: string; resultResourceId: string | null };
type SequenceRow = { sequenceNo: number | string };
type MessageRow = {
  id: string;
  gameId: string;
  playerId: string;
  status: PublicMessage['status'];
  verdict: PublicMessage['verdict'];
  challengeStatus: NonNullable<PublicMessage['challengeStatus']>;
};
type JudgmentRow = { messageId: string; promptVersion: string; schemaVersion: string };
type MissingJudgmentRow = { missingCount: number | string };
type ChallengeRow = { id: string; messageId: string; status: NonNullable<PublicMessage['challengeStatus']> };

function transactionFor(dependencies: SubmitChallengeDependencies) {
  return dependencies.transaction ?? withWebTransaction;
}

function idFactoryFor(dependencies: SubmitChallengeDependencies): () => string {
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
  if (!isWorkerHealthy(rows[0]?.lastSeenAt, now)) throw new ChallengeJudgmentUnavailableError();
}

function challengeReceipt(row: ChallengeRow): ChallengeReceipt {
  return { challengeId: row.id, messageId: row.messageId, status: row.status };
}

async function selectChallenge(sql: TransactionSql | Sql, challengeId: string): Promise<ChallengeReceipt | null> {
  const rows = await sql<ChallengeRow[]>`
    select id, message_id as "messageId", status
    from private.message_challenges
    where id = ${challengeId}
    limit 1
  `;
  return rows[0] ? challengeReceipt(rows[0]) : null;
}

export async function submitChallenge(
  input: SubmitChallengeInput,
  dependencies: SubmitChallengeDependencies = {},
): Promise<ChallengeReceipt> {
  const playerId = requireUuid(input.playerId, 'playerId');
  const messageId = requireUuid(input.messageId, 'messageId');
  const idempotencyKey = requireUuid(input.idempotencyKey, 'Idempotency-Key');
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
    if (!game || game.status !== 'ACTIVE') throw new ChallengeMessageNotFoundError();

    const existing = await sql<ActionRow[]>`
      select payload_digest as "payloadDigest", result_resource_id::text as "resultResourceId"
      from private.game_actions
      where game_id = ${game.id}
        and player_id = ${playerId}
        and action_type = 'CHALLENGE'
        and idempotency_key = ${idempotencyKey}::uuid
    `;
    if (existing[0]) {
      if (existing[0].payloadDigest !== input.payloadDigest) throw new IdempotencyConflictError();
      if (!existing[0].resultResourceId) throw new ChallengeReceiptNotFoundError();
      const replay = await selectChallenge(sql, existing[0].resultResourceId);
      if (!replay) throw new ChallengeReceiptNotFoundError();
      return replay;
    }

    const messages = await sql<MessageRow[]>`
      select
        id,
        game_id as "gameId",
        player_id as "playerId",
        status,
        verdict,
        challenge_status as "challengeStatus"
      from api.messages
      where id = ${messageId}
        and game_id = ${game.id}
      for update
    `;
    const message = messages[0];
    if (!message || message.status !== 'JUDGED' || !message.verdict) throw new ChallengeMessageNotFoundError();
    if (message.challengeStatus === 'PENDING') throw new ChallengeInProgressError();
    if (message.challengeStatus !== 'NONE') throw new ChallengeAlreadySubmittedError();

    const judgments = await sql<JudgmentRow[]>`
      select message_id as "messageId", prompt_version as "promptVersion", schema_version as "schemaVersion"
      from private.question_judgments
      where message_id = ${message.id}
        and game_id = ${game.id}
        and player_id = ${message.playerId}
        and prompt_version = 'question-judge-v6'
        and schema_version = 'judge-schema-v1'
      limit 1
    `;
    if (!judgments[0]) throw new ChallengeMessageNotFoundError();

    // Rebuilding first-hit claims is only safe when every judged message in
    // the game has the immutable v6 coverage record. Legacy rows are not
    // inferred or silently re-scored during a challenge.
    const missingJudgments = await sql<MissingJudgmentRow[]>`
      select count(*)::integer as "missingCount"
      from api.messages messages
      where messages.game_id = ${game.id}
        and messages.status = 'JUDGED'
        and not exists (
          select 1
          from private.question_judgments judgments
          where judgments.message_id = messages.id
            and judgments.game_id = messages.game_id
            and judgments.prompt_version = 'question-judge-v6'
            and judgments.schema_version = 'judge-schema-v1'
        )
    `;
    if (Number(missingJudgments[0]?.missingCount ?? 0) > 0) throw new ChallengeMessageNotFoundError();

    const sequenceRows = await sql<SequenceRow[]>`
      select coalesce(max(sequence_no), 0) as "sequenceNo"
      from private.game_actions
      where game_id = ${game.id}
    `;
    const sequenceNo = Number(sequenceRows[0]?.sequenceNo ?? 0) + 1;
    const challengeId = makeId();
    const actionId = makeId();

    await sql`
      insert into private.message_challenges
        (id, message_id, game_id, player_id, status, required_valid_judgments, valid_judgment_count, created_at, updated_at)
      values
        (${challengeId}, ${message.id}, ${game.id}, ${playerId}, 'PENDING', 5, 0, now(), now())
    `;
    await sql`
      update api.messages
      set challenge_status = 'PENDING', updated_at = now()
      where id = ${message.id} and challenge_status = 'NONE'
    `;
    await sql`
      insert into private.game_actions
        (id, game_id, player_id, sequence_no, action_type, status,
         attempt_count, next_attempt_at, lease_owner, lease_expires_at,
         idempotency_key, payload_digest, result_resource_id, error_code,
         created_at, updated_at)
      values
        (${actionId}, ${game.id}, ${playerId}, ${sequenceNo}, 'CHALLENGE', 'PENDING',
         0, now(), null, null, ${idempotencyKey}::uuid, ${input.payloadDigest}, ${challengeId}::uuid, null,
         now(), now())
    `;
    const receipt = await selectChallenge(sql, challengeId);
    if (receipt) return receipt;
    throw new ChallengeReceiptNotFoundError();
  });
}

export async function getChallengeById(challengeId: string, dependencies: { sql?: Sql } = {}): Promise<ChallengeReceipt | null> {
  return selectChallenge(dependencies.sql ?? getDb(), requireUuid(challengeId, 'challengeId'));
}
