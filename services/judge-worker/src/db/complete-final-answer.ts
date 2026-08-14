import type { TransactionSql } from 'postgres';
import { withWorkerTransaction, type WorkerTransaction } from './client.js';

export type CompleteFinalAnswerInput = {
  actionId: string;
  workerId: string;
  coveredKeyPointIds: string[];
};

export type CompleteFinalAnswerDependencies = {
  transaction?: WorkerTransaction;
  now?: Date;
};

type ActionRow = {
  id: string;
  gameId: string;
  playerId: string;
  sequenceNo: number | string;
  actionType: string;
  status: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  resultResourceId: string | null;
};

type SubmissionRow = {
  id: string;
  gameId: string;
  playerId: string;
  status: string;
};

type GameRow = { id: string; status: string };
type KeyPointRow = { id: string; content: string; ordinal: number };
type SecretRow = { fullSolution: string };

// Keep the Worker-side predicate identical to game-core. The compiled Worker
// image cannot import the workspace package's TypeScript source at runtime.
function isFinalAnswerSuccessful(allIds: readonly string[], coveredIds: readonly string[]): boolean {
  const all = new Set(allIds);
  const covered = new Set(coveredIds);
  return covered.size === all.size && [...all].every((id) => covered.has(id));
}

function transactionFor(dependencies: CompleteFinalAnswerDependencies): WorkerTransaction {
  return dependencies.transaction ?? withWorkerTransaction;
}

function activeLease(action: ActionRow, workerId: string, now: Date): boolean {
  if (action.status !== 'PROCESSING' || action.leaseOwner !== workerId || !action.leaseExpiresAt) return false;
  return new Date(action.leaseExpiresAt).getTime() > now.getTime();
}

function uniqueKeyPointIds(ids: string[]): string[] {
  const sorted = [...ids].sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) throw new Error('DUPLICATE_KEY_POINT_ID');
  }
  return sorted;
}

async function cancelLaterActions(sql: TransactionSql, gameId: string, sequenceNo: number | string): Promise<void> {
  await sql`
    update api.messages
    set status = 'CANCELLED',
        updated_at = now()
    where id in (
      select result_resource_id
      from private.game_actions
      where game_id = ${gameId}
        and sequence_no > ${sequenceNo}
        and action_type = 'NORMAL_MESSAGE'
        and status not in ('COMPLETED', 'CANCELLED')
    )
      and status = 'PENDING'
  `;
  await sql`
    update private.final_answer_submissions
    set status = 'CANCELLED',
        judged_at = now()
    where action_id in (
      select id
      from private.game_actions
      where game_id = ${gameId}
        and sequence_no > ${sequenceNo}
        and action_type = 'FINAL_ANSWER'
        and status not in ('COMPLETED', 'CANCELLED')
    )
      and status not in ('COMPLETED', 'CANCELLED')
  `;
  await sql`
    update private.game_actions
    set status = 'CANCELLED',
        lease_owner = null,
        lease_expires_at = null,
        error_code = null,
        updated_at = now()
    where game_id = ${gameId}
      and sequence_no > ${sequenceNo}
      and status not in ('COMPLETED', 'CANCELLED')
  `;
}

export async function completeFinalAnswer(
  input: CompleteFinalAnswerInput,
  dependencies: CompleteFinalAnswerDependencies = {},
): Promise<void> {
  const ids = uniqueKeyPointIds(input.coveredKeyPointIds);
  const now = dependencies.now ?? new Date();

  await transactionFor(dependencies)(async (sql) => {
    const actions = await sql<ActionRow[]>`
      select
        id,
        game_id as "gameId",
        player_id as "playerId",
        sequence_no as "sequenceNo",
        action_type as "actionType",
        status,
        lease_owner as "leaseOwner",
        lease_expires_at as "leaseExpiresAt",
        result_resource_id::text as "resultResourceId"
      from private.game_actions
      where id = ${input.actionId}
      for update
    `;
    const action = actions[0];
    if (!action || action.status === 'COMPLETED' || action.status === 'CANCELLED' || action.actionType !== 'FINAL_ANSWER') return;
    if (!activeLease(action, input.workerId, now)) return;

    const games = await sql<GameRow[]>`
      select id, status
      from api.games
      where id = ${action.gameId}
      for update
    `;
    const game = games[0];
    if (!game || game.status !== 'ACTIVE') return;
    if (!action.resultResourceId) return;

    const submissions = await sql<SubmissionRow[]>`
      select
        id,
        game_id as "gameId",
        player_id as "playerId",
        status
      from private.final_answer_submissions
      where id = ${action.resultResourceId}
        and action_id = ${action.id}
        and game_id = ${action.gameId}
        and player_id = ${action.playerId}
      for update
    `;
    const submission = submissions[0];
    if (!submission || submission.status !== 'PENDING') return;

    const keyPoints = await sql<KeyPointRow[]>`
      select id, content, ordinal
      from private.key_points
      where game_id = ${action.gameId}
      order by ordinal asc
    `;
    const allIds = keyPoints.map((point) => point.id);
    const allowedIds = new Set(allIds);
    for (const id of ids) {
      if (!allowedIds.has(id)) throw new Error('UNKNOWN_KEY_POINT_ID');
    }

    const success = isFinalAnswerSuccessful(allIds, ids);
    let solution: SecretRow | undefined;
    if (success) {
      const solutions = await sql<SecretRow[]>`
        select full_solution as "fullSolution"
        from private.game_secrets
        where game_id = ${action.gameId}
        order by input_version desc
        limit 1
      `;
      solution = solutions[0];
      if (!solution) throw new Error('FINAL_ANSWER_REVEAL_NOT_FOUND');
    }

    await sql`
      update private.final_answer_submissions
      set covered_key_point_ids = ${ids}::uuid[],
          status = 'COMPLETED',
          judged_at = now()
      where id = ${submission.id}
        and status = 'PENDING'
    `;
    await sql`
      insert into api.game_events
        (id, game_id, sequence_no, event_type, player_id, awarded_points, created_at)
      values
        (${action.id}, ${action.gameId}, ${action.sequenceNo}, ${success ? 'FINAL_ANSWER_SUCCEEDED' : 'FINAL_ANSWER_FAILED'}, ${action.playerId}, ${success ? 2 : 0}, now())
      on conflict (game_id, sequence_no) do nothing
    `;

    if (success && solution) {
      await sql`
        update api.players
        set lifetime_score = lifetime_score + 2,
            updated_at = now()
        where id = ${action.playerId}
      `;
      await sql`
        insert into api.game_reveals (game_id, full_solution, revealed_at)
        values (${action.gameId}, ${solution.fullSolution}, now())
        on conflict (game_id) do nothing
      `;
      for (const point of keyPoints) {
        await sql`
          insert into api.revealed_key_points (game_id, ordinal, content)
          values (${action.gameId}, ${point.ordinal}, ${point.content})
          on conflict (game_id, ordinal) do nothing
        `;
      }
      await sql`
        update api.games
        set status = 'ENDED',
            end_reason = 'FINAL_ANSWER_SUCCESS',
            winner_player_id = ${action.playerId},
            ended_at = now(),
            updated_at = now()
        where id = ${action.gameId} and status = 'ACTIVE'
      `;
      await cancelLaterActions(sql, action.gameId, action.sequenceNo);
    }

    await sql`
      update private.game_actions
      set status = 'COMPLETED',
          lease_owner = null,
          lease_expires_at = null,
          error_code = null,
          updated_at = now()
      where id = ${input.actionId}
        and status = 'PROCESSING'
        and lease_owner = ${input.workerId}
    `;
  });
}
