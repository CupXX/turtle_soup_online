import { rebuildEvidenceProgress, type EvidenceProgressJudgment, type EvidenceProgressKeyPoint } from '@turtle-soup/game-core';
import type { TransactionSql } from 'postgres';

type EvidenceRow = { keyPointId: string; evidenceId: string | null };
type JudgmentRow = {
  messageId: string;
  playerId: string;
  sequenceNo: number | string;
  currentEstablishedEvidenceIds: unknown;
  currentVerdict: string;
};
type AwardRow = { playerId: string; points: number };

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];
  return trimmed.slice(1, -1)
    .split(',')
    .map((item) => item.replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function addPoints(target: Map<string, number>, playerId: string, points: number): void {
  target.set(playerId, (target.get(playerId) ?? 0) + points);
}

export type EvidenceProgressRebuildResult = {
  discoveredCount: number;
  awardsByPlayer: Record<string, number>;
};

/**
 * Rebuilds all derived Evidence progress while the caller holds the game row
 * lock. The LLM never participates in this reducer.
 */
export async function rebuildEvidenceProgressInTransaction(
  sql: TransactionSql,
  gameId: string,
): Promise<EvidenceProgressRebuildResult> {
  const evidenceRows = await sql<EvidenceRow[]>`
    select
      points.id as "keyPointId",
      evidence.id as "evidenceId"
    from private.key_points points
    left join private.key_point_evidence evidence on evidence.key_point_id = points.id
    where points.game_id = ${gameId}
    order by points.ordinal asc, evidence.ordinal asc
  `;
  const keyPointOrder: string[] = [];
  const evidenceByKeyPoint = new Map<string, string[]>();
  for (const row of evidenceRows) {
    if (!evidenceByKeyPoint.has(row.keyPointId)) keyPointOrder.push(row.keyPointId);
    if (row.evidenceId) evidenceByKeyPoint.set(row.keyPointId, [...(evidenceByKeyPoint.get(row.keyPointId) ?? []), row.evidenceId]);
  }
  const keyPoints: EvidenceProgressKeyPoint[] = keyPointOrder.map((id) => ({
    id,
    requiredEvidenceIds: evidenceByKeyPoint.get(id) ?? [],
  }));

  const judgments = await sql<JudgmentRow[]>`
    select
      judgments.message_id as "messageId",
      messages.player_id as "playerId",
      messages.sequence_no as "sequenceNo",
      judgments.current_established_evidence_ids as "currentEstablishedEvidenceIds",
      judgments.current_verdict as "currentVerdict"
    from private.question_judgments judgments
    join api.messages messages on messages.id = judgments.message_id
    where judgments.game_id = ${gameId}
      and messages.status = 'JUDGED'
    order by messages.sequence_no asc
    for update of judgments, messages
  `;
  const progressJudgments: EvidenceProgressJudgment[] = judgments.map((row) => ({
    messageId: row.messageId,
    playerId: row.playerId,
    sequenceNo: Number(row.sequenceNo),
    establishedEvidenceIds: arrayValue(row.currentEstablishedEvidenceIds),
  }));
  const rebuilt = rebuildEvidenceProgress(keyPoints, progressJudgments);
  const oldAwards = await sql<AwardRow[]>`
    select player_id as "playerId", coalesce(sum(awarded_points), 0)::integer as points
    from api.messages
    where game_id = ${gameId}
    group by player_id
  `;
  await sql`
    delete from private.key_point_claims
    where game_id = ${gameId}
  `;
  await sql`
    update api.messages
    set awarded_points = 0, updated_at = now()
    where game_id = ${gameId} and status = 'JUDGED'
  `;

  const newAwards = new Map<string, number>();
  for (const claim of rebuilt.claims) {
    await sql`
      insert into private.key_point_claims
        (key_point_id, game_id, message_id, player_id, claimed_at)
      values (${claim.keyPointId}, ${gameId}, ${claim.messageId}, ${claim.playerId}, now())
      on conflict (key_point_id) do nothing
    `;
  }
  for (const row of rebuilt.messages) {
    addPoints(newAwards, row.playerId, row.awardedPoints);
    await sql`
      update api.messages
      set awarded_points = ${row.awardedPoints}, updated_at = now()
      where id = ${row.messageId} and game_id = ${gameId}
    `;
    await sql`
      update private.question_judgments
      set current_covered_key_point_ids = ${row.discoveredKeyPointIds}::uuid[],
          updated_at = now()
      where message_id = ${row.messageId} and game_id = ${gameId}
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
    set discovered_key_point_count = ${rebuilt.discoveredCount}, updated_at = now()
    where id = ${gameId} and status = 'ACTIVE'
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
    where stats.game_id = ${gameId}
  `;

  return { discoveredCount: rebuilt.discoveredCount, awardsByPlayer: rebuilt.awardsByPlayer };
}
