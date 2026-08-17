import type { ChallengeOutcome, JudgeVerdict } from '@turtle-soup/contracts';
import { resolveChallengeVotes, type ChallengeVote } from '@turtle-soup/game-core';
import { withWorkerTransaction, type WorkerTransaction } from './client.js';

export type CompleteChallengeFreshJudgment = {
  slot: number;
  verdict: JudgeVerdict;
  coveredKeyPointIds: string[];
};

export type CompleteChallengeInput = {
  actionId: string;
  workerId: string;
  challengeId: string;
  freshJudgments: CompleteChallengeFreshJudgment[];
};

export type CompleteChallengeDependencies = {
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
type ChallengeRow = { id: string; messageId: string; gameId: string; status: string };
type MessageRow = { id: string; gameId: string; playerId: string; sequenceNo: number | string; status: string; challengeStatus: string; awardedPoints: number };
type JudgmentRow = { messageId: string; currentVerdict: JudgeVerdict; currentCoveredKeyPointIds: string[] };
type RebuildRow = JudgmentRow & { playerId: string; sequenceNo: number | string; messageStatus: string };
type PointRow = { id: string };
type AwardRow = { playerId: string; points: number };

function transactionFor(dependencies: CompleteChallengeDependencies): WorkerTransaction {
  return dependencies.transaction ?? withWorkerTransaction;
}

function activeLease(action: ActionRow, workerId: string, now: Date): boolean {
  if (action.status !== 'PROCESSING' || action.leaseOwner !== workerId || !action.leaseExpiresAt) return false;
  return new Date(action.leaseExpiresAt).getTime() > now.getTime();
}

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed.slice(1, -1).split(',').map((item) => item.replace(/^"|"$/g, '')).filter(Boolean);
  return [];
}

function uniqueSorted(ids: readonly string[]): string[] {
  const sorted = [...ids].sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) throw new Error('DUPLICATE_KEY_POINT_ID');
  }
  return sorted;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function addPoints(target: Map<string, number>, playerId: string, points: number): void {
  target.set(playerId, (target.get(playerId) ?? 0) + points);
}

export async function completeChallenge(
  input: CompleteChallengeInput,
  dependencies: CompleteChallengeDependencies = {},
): Promise<void> {
  if (input.freshJudgments.length !== 4) throw new Error('INCOMPLETE_CHALLENGE_JUDGMENTS');
  const slots = input.freshJudgments.map(({ slot }) => slot).sort((left, right) => left - right);
  if (slots.join(',') !== '1,2,3,4') throw new Error('INCOMPLETE_CHALLENGE_JUDGMENTS');
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
    if (!action || action.status === 'COMPLETED' || action.actionType !== 'CHALLENGE') return;
    if (!activeLease(action, input.workerId, now)) return;

    const games = await sql<GameRow[]>`
      select id, status
      from api.games
      where id = ${action.gameId}
      for update
    `;
    const game = games[0];
    if (!game || game.status !== 'ACTIVE' || action.resultResourceId !== input.challengeId) return;

    const challenges = await sql<ChallengeRow[]>`
      select id, message_id as "messageId", game_id as "gameId", status
      from private.message_challenges
      where id = ${input.challengeId}
        and game_id = ${action.gameId}
      for update
    `;
    const challenge = challenges[0];
    if (!challenge || challenge.status !== 'PENDING') return;

    const messages = await sql<MessageRow[]>`
      select
        id,
        game_id as "gameId",
        player_id as "playerId",
        sequence_no as "sequenceNo",
        status,
        challenge_status as "challengeStatus",
        awarded_points as "awardedPoints"
      from api.messages
      where id = ${challenge.messageId}
        and game_id = ${action.gameId}
      for update
    `;
    const message = messages[0];
    if (!message || message.status !== 'JUDGED' || message.challengeStatus !== 'PENDING') return;

    const originalRows = await sql<JudgmentRow[]>`
      select
        message_id as "messageId",
        original_verdict as "currentVerdict",
        original_covered_key_point_ids as "currentCoveredKeyPointIds"
      from private.question_judgments
      where message_id = ${message.id}
        and game_id = ${action.gameId}
      for update
    `;
    const original = originalRows[0];
    if (!original) throw new Error('QUESTION_JUDGMENT_NOT_FOUND');

    const keyPoints = await sql<PointRow[]>`
      select id
      from private.key_points
      where game_id = ${action.gameId}
      order by ordinal asc
    `;
    const keyPointIds = keyPoints.map(({ id }) => id);
    const allowed = new Set(keyPointIds);
    const originalCovered = uniqueSorted(arrayValue(original.currentCoveredKeyPointIds));
    const originalVote: ChallengeVote = { valid: true, verdict: original.currentVerdict, coveredKeyPointIds: originalCovered };
    const freshVotes: ChallengeVote[] = input.freshJudgments.map(({ verdict, coveredKeyPointIds }) => ({
      valid: true,
      verdict,
      coveredKeyPointIds: uniqueSorted(coveredKeyPointIds),
    }));
    const resolution = resolveChallengeVotes([originalVote, ...freshVotes], keyPointIds);
    for (const id of resolution.coveredKeyPointIds) if (!allowed.has(id)) throw new Error('UNKNOWN_KEY_POINT_ID');
    const challengeOutcome: ChallengeOutcome = resolution.verdict === originalVote.verdict
      && sameIds(resolution.coveredKeyPointIds, originalCovered)
      ? 'UPHELD'
      : 'SUCCESS';

    await sql`
      update private.question_judgments
      set current_verdict = ${resolution.verdict},
          current_covered_key_point_ids = ${resolution.coveredKeyPointIds}::uuid[],
          updated_at = now()
      where message_id = ${message.id}
    `;

    const oldAwards = await sql<AwardRow[]>`
      select player_id as "playerId", coalesce(sum(awarded_points), 0)::integer as points
      from api.messages
      where game_id = ${action.gameId}
      group by player_id
    `;
    const judgments = await sql<RebuildRow[]>`
      select
        judgments.message_id as "messageId",
        judgments.current_verdict as "currentVerdict",
        judgments.current_covered_key_point_ids as "currentCoveredKeyPointIds",
        messages.player_id as "playerId",
        messages.sequence_no as "sequenceNo",
        messages.status as "messageStatus"
      from private.question_judgments judgments
      join api.messages messages on messages.id = judgments.message_id
      where judgments.game_id = ${action.gameId}
        and messages.status = 'JUDGED'
      order by messages.sequence_no asc
      for update of judgments, messages
    `;

    await sql`
      delete from private.key_point_claims
      where game_id = ${action.gameId}
    `;
    await sql`
      update api.messages
      set awarded_points = 0, updated_at = now()
      where game_id = ${action.gameId} and status = 'JUDGED'
    `;

    const newAwards = new Map<string, number>();
    let discoveredCount = 0;
    for (const row of judgments) {
      const ids = uniqueSorted(arrayValue(row.currentCoveredKeyPointIds));
      let messageAward = 0;
      for (const id of ids) {
        if (!allowed.has(id)) throw new Error('UNKNOWN_KEY_POINT_ID');
        const inserted = await sql<Array<{ keyPointId: string }>>`
          insert into private.key_point_claims
            (key_point_id, game_id, message_id, player_id, claimed_at)
          values (${id}, ${action.gameId}, ${row.messageId}, ${row.playerId}, now())
          on conflict (key_point_id) do nothing
          returning key_point_id as "keyPointId"
        `;
        if (inserted.length) {
          discoveredCount += inserted.length;
          addPoints(newAwards, row.playerId, inserted.length);
          messageAward += inserted.length;
        }
      }
      await sql`
        update api.messages
        set awarded_points = ${messageAward},
            updated_at = now()
        where id = ${row.messageId}
      `;
    }

    const oldByPlayer = new Map(oldAwards.map(({ playerId, points }) => [playerId, Number(points)]));
    const players = new Set([...oldByPlayer.keys(), ...newAwards.keys()]);
    for (const playerId of players) {
      const delta = (newAwards.get(playerId) ?? 0) - (oldByPlayer.get(playerId) ?? 0);
      if (delta === 0) continue;
      await sql`
        update api.players
        set lifetime_score = lifetime_score + ${delta}, updated_at = now()
        where id = ${playerId}
      `;
    }
    await sql`
      update api.games
      set discovered_key_point_count = ${discoveredCount}, updated_at = now()
      where id = ${action.gameId} and status = 'ACTIVE'
    `;
    await sql`
      update api.game_player_stats stats
      set yes_count = (
        select count(*)::integer
        from api.messages messages
        where messages.game_id = stats.game_id
          and messages.player_id = stats.player_id
          and messages.status = 'JUDGED'
          and messages.verdict = 'YES'
      ),
      updated_at = now()
      where stats.game_id = ${action.gameId}
    `;
    await sql`
      update private.message_challenges
      set status = 'RESOLVED',
          valid_judgment_count = 5,
          resolved_verdict = ${resolution.verdict},
          resolved_covered_key_point_ids = ${resolution.coveredKeyPointIds}::uuid[],
          resolved_at = now(),
          updated_at = now()
      where id = ${challenge.id} and status = 'PENDING'
    `;
    await sql`
      update api.messages
      set verdict = ${resolution.verdict},
          challenge_status = 'RESOLVED',
          challenge_outcome = ${challengeOutcome},
          updated_at = now()
      where id = ${message.id} and challenge_status = 'PENDING'
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
