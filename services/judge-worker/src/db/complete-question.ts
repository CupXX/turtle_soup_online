import type { JudgeVerdict } from '@turtle-soup/contracts';
import { withWorkerTransaction, type WorkerTransaction } from './client.js';

export type CompleteQuestionInput = {
  actionId: string;
  workerId: string;
  verdict: JudgeVerdict;
  fullyCoveredKeyPointIds: string[];
};

export type CompleteQuestionDependencies = {
  transaction?: WorkerTransaction;
  now?: Date;
};

type ActionRow = {
  id: string;
  gameId: string;
  playerId: string;
  actionType: string;
  status: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  resultResourceId: string | null;
};

type GameRow = { id: string; status: string };
type MessageRow = { id: string; gameId: string; playerId: string; status: string };

const VERDICTS = new Set<JudgeVerdict>(['YES', 'NO', 'BOTH', 'IRRELEVANT']);

function transactionFor(dependencies: CompleteQuestionDependencies): WorkerTransaction {
  return dependencies.transaction ?? withWorkerTransaction;
}

function activeLease(action: ActionRow, workerId: string, now: Date): boolean {
  if (action.status !== 'PROCESSING' || action.leaseOwner !== workerId || !action.leaseExpiresAt) return false;
  return new Date(action.leaseExpiresAt).getTime() > now.getTime();
}

function uniqueKeyPointIds(ids: string[]): string[] {
  const sorted = [...ids].sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      throw new Error('DUPLICATE_KEY_POINT_ID');
    }
  }
  return sorted;
}

export async function completeQuestion(
  input: CompleteQuestionInput,
  dependencies: CompleteQuestionDependencies = {},
): Promise<void> {
  if (!VERDICTS.has(input.verdict)) throw new Error('INVALID_VERDICT');
  const ids = uniqueKeyPointIds(input.fullyCoveredKeyPointIds);
  const now = dependencies.now ?? new Date();

  await transactionFor(dependencies)(async (sql) => {
    const actions = await sql<ActionRow[]>`
      select
        id,
        game_id as "gameId",
        player_id as "playerId",
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
    if (!action || action.status === 'COMPLETED' || action.actionType !== 'NORMAL_MESSAGE') return;
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

    const messages = await sql<MessageRow[]>`
      select id, game_id as "gameId", player_id as "playerId", status
      from api.messages
      where id = ${action.resultResourceId}
        and game_id = ${action.gameId}
        and player_id = ${action.playerId}
      for update
    `;
    const message = messages[0];
    if (!message || message.status !== 'PENDING') return;

    for (const keyPointId of ids) {
      const keyPoints = await sql<Array<{ id: string }>>`
        select id
        from private.key_points
        where id = ${keyPointId}
          and game_id = ${action.gameId}
        order by id
        for update
      `;
      if (!keyPoints[0]) throw new Error('UNKNOWN_KEY_POINT_ID');
    }

    let newlyClaimed = 0;
    for (const keyPointId of ids) {
      const claims = await sql<Array<{ keyPointId: string }>>`
        insert into private.key_point_claims
          (key_point_id, game_id, message_id, player_id, claimed_at)
        values (${keyPointId}, ${action.gameId}, ${message.id}, ${action.playerId}, now())
        on conflict (key_point_id) do nothing
        returning key_point_id as "keyPointId"
      `;
      newlyClaimed += claims.length;
    }

    if (newlyClaimed > 0) {
      await sql`
        update api.players
        set lifetime_score = lifetime_score + ${newlyClaimed},
            updated_at = now()
        where id = ${action.playerId}
      `;
    }
    await sql`
      update api.games
      set discovered_key_point_count = discovered_key_point_count + ${newlyClaimed},
          updated_at = now()
      where id = ${action.gameId} and status = 'ACTIVE'
    `;
    await sql`
      update api.messages
      set status = 'JUDGED',
          verdict = ${input.verdict},
          awarded_points = ${newlyClaimed},
          judged_at = now(),
          updated_at = now()
      where id = ${message.id} and status = 'PENDING'
    `;
    await sql`
      update api.game_player_stats
      set yes_count = yes_count + ${input.verdict === 'YES' ? 1 : 0},
          updated_at = now()
      where game_id = ${action.gameId} and player_id = ${action.playerId}
    `;
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
