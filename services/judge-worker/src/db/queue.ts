import type { JudgeErrorCode } from '@turtle-soup/contracts';
import { withWorkerTransaction, type WorkerTransaction } from './client.js';

export const RETRY_SECONDS = [2, 5, 15] as const;
export const LEASE_SECONDS = 60;

export type ClaimedExtraction = {
  id: string;
  gameId: string;
  inputVersion: number;
  attempt: number;
  leaseOwner: string;
  leaseExpiresAt: string;
};

export type ClaimedAction = {
  id: string;
  gameId: string;
  playerId: string;
  sequenceNo: number;
  actionType: 'NORMAL_MESSAGE' | 'FINAL_ANSWER';
  attempt: number;
  leaseOwner: string;
  leaseExpiresAt: string;
};

export type QueueDependencies = {
  transaction?: WorkerTransaction;
  now?: Date;
};

type ExtractionCandidate = Pick<ClaimedExtraction, 'id' | 'gameId' | 'inputVersion' | 'attempt'>;
type ActionCandidate = Pick<ClaimedAction, 'id' | 'gameId' | 'playerId' | 'sequenceNo' | 'actionType' | 'attempt'>;

export function retryDelaySeconds(failedAttempt: number): number | null {
  return RETRY_SECONDS[failedAttempt - 1] ?? null;
}

function transactionFor(dependencies: QueueDependencies): WorkerTransaction {
  return dependencies.transaction ?? withWorkerTransaction;
}

function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + LEASE_SECONDS * 1000);
}

export async function claimNextExtraction(
  workerId: string,
  now: Date,
  dependencies: Pick<QueueDependencies, 'transaction'> = {},
): Promise<ClaimedExtraction | null> {
  const expiresAt = leaseExpiry(now);
  return transactionFor(dependencies)(async (sql) => {
    const candidates = await sql<ExtractionCandidate[]>`
      select
        jobs.id,
        jobs.game_id as "gameId",
        jobs.input_version as "inputVersion",
        jobs.attempt_count as attempt
      from private.key_point_extraction_jobs jobs
      join api.games games on games.id = jobs.game_id
      join private.game_secrets secrets
        on secrets.game_id = jobs.game_id
       and secrets.input_version = jobs.input_version
      where games.status = 'WAITING'
        and jobs.attempt_count < 4
        and jobs.next_attempt_at <= ${now}
        and (
          jobs.status in ('PENDING', 'RETRY')
          or (jobs.status = 'PROCESSING' and jobs.lease_expires_at <= ${now})
        )
      order by jobs.next_attempt_at asc, jobs.created_at asc
      limit 1
      for update of jobs
    `;
    const candidate = candidates[0];
    if (!candidate) return null;

    const leased = await sql<ClaimedExtraction[]>`
      update private.key_point_extraction_jobs
      set status = 'PROCESSING',
          attempt_count = attempt_count + 1,
          lease_owner = ${workerId},
          lease_expires_at = ${expiresAt},
          updated_at = now()
      where id = ${candidate.id}
        and attempt_count < 4
      returning
        id,
        game_id as "gameId",
        input_version as "inputVersion",
        attempt_count as attempt,
        lease_owner as "leaseOwner",
        lease_expires_at as "leaseExpiresAt"
    `;
    return leased[0] ?? null;
  });
}

export async function claimNextAction(
  workerId: string,
  now: Date,
  dependencies: Pick<QueueDependencies, 'transaction'> = {},
): Promise<ClaimedAction | null> {
  const expiresAt = leaseExpiry(now);
  return transactionFor(dependencies)(async (sql) => {
    const candidates = await sql<ActionCandidate[]>`
      select
        actions.id,
        actions.game_id as "gameId",
        actions.player_id as "playerId",
        actions.sequence_no as "sequenceNo",
        actions.action_type as "actionType",
        actions.attempt_count as attempt
      from private.game_actions actions
      join api.games games on games.id = actions.game_id
      where games.status = 'ACTIVE'
        and actions.attempt_count < 4
        and actions.next_attempt_at <= ${now}
        and (
          actions.status in ('PENDING', 'RETRY')
          or (actions.status = 'PROCESSING' and actions.lease_expires_at <= ${now})
        )
        and not exists (
          select 1
          from private.game_actions earlier
          where earlier.game_id = actions.game_id
            and earlier.sequence_no < actions.sequence_no
            and earlier.status not in ('COMPLETED', 'CANCELLED')
        )
      order by actions.game_id asc, actions.sequence_no asc
      limit 1
      for update of actions
    `;
    const candidate = candidates[0];
    if (!candidate) return null;

    const leased = await sql<ClaimedAction[]>`
      update private.game_actions
      set status = 'PROCESSING',
          attempt_count = attempt_count + 1,
          lease_owner = ${workerId},
          lease_expires_at = ${expiresAt},
          updated_at = now()
      where id = ${candidate.id}
        and attempt_count < 4
      returning
        id,
        game_id as "gameId",
        player_id as "playerId",
        sequence_no as "sequenceNo",
        action_type as "actionType",
        attempt_count as attempt,
        lease_owner as "leaseOwner",
        lease_expires_at as "leaseExpiresAt"
    `;
    return leased[0] ?? null;
  });
}

export async function recordExtractionRetry(
  jobId: string,
  attempt: number,
  code: JudgeErrorCode,
  dependencies: QueueDependencies = {},
): Promise<void> {
  const delay = retryDelaySeconds(attempt);
  if (delay === null) {
    await markExtractionBlocked(jobId, code, dependencies);
    return;
  }

  const nextAttemptAt = new Date((dependencies.now ?? new Date()).getTime() + delay * 1000);
  await transactionFor(dependencies)(async (sql) => {
    await sql`
      update private.key_point_extraction_jobs
      set status = 'RETRY',
          attempt_count = ${attempt},
          next_attempt_at = ${nextAttemptAt},
          lease_owner = null,
          lease_expires_at = null,
          error_code = ${code},
          updated_at = now()
      where id = ${jobId}
        and status = 'PROCESSING'
    `;
  });
}

export async function markExtractionBlocked(
  jobId: string,
  code: JudgeErrorCode,
  dependencies: QueueDependencies = {},
): Promise<void> {
  await transactionFor(dependencies)(async (sql) => {
    await sql`
      update private.key_point_extraction_jobs
      set status = 'BLOCKED',
          lease_owner = null,
          lease_expires_at = null,
          error_code = ${code},
          updated_at = now()
      where id = ${jobId}
    `;
  });
}

export async function recordActionRetry(
  actionId: string,
  attempt: number,
  code: JudgeErrorCode,
  dependencies: QueueDependencies = {},
): Promise<void> {
  const delay = retryDelaySeconds(attempt);
  if (delay === null) {
    await markActionBlocked(actionId, code, dependencies);
    return;
  }

  const nextAttemptAt = new Date((dependencies.now ?? new Date()).getTime() + delay * 1000);
  await transactionFor(dependencies)(async (sql) => {
    await sql`
      update private.game_actions
      set status = 'RETRY',
          attempt_count = ${attempt},
          next_attempt_at = ${nextAttemptAt},
          lease_owner = null,
          lease_expires_at = null,
          error_code = ${code},
          updated_at = now()
      where id = ${actionId}
        and status = 'PROCESSING'
    `;
  });
}

export async function markActionBlocked(
  actionId: string,
  code: JudgeErrorCode,
  dependencies: QueueDependencies = {},
): Promise<void> {
  await transactionFor(dependencies)(async (sql) => {
    await sql`
      update private.game_actions
      set status = 'BLOCKED',
          lease_owner = null,
          lease_expires_at = null,
          error_code = ${code},
          updated_at = now()
      where id = ${actionId}
    `;
  });
}
