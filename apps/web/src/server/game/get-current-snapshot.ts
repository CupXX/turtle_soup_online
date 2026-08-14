import type {
  PublicGame,
  PublicGameEvent,
  PublicGameReveal,
  PublicGameSnapshot,
  PublicMessage,
  PublicPlayer,
  PublicPlayerStats,
  PublicRevealedKeyPoint,
} from '@turtle-soup/contracts';
import type { Sql } from 'postgres';

type GameRow = PublicGame;
type PlayerStatsRow = PublicPlayerStats & PublicPlayer;
type RevealRow = Pick<PublicGameReveal, 'fullSolution' | 'revealedAt'>;

function bySequence<T extends { sequenceNo: number }>(left: T, right: T): number {
  return left.sequenceNo - right.sequenceNo;
}

function byOrdinal(left: PublicRevealedKeyPoint, right: PublicRevealedKeyPoint): number {
  return left.ordinal - right.ordinal;
}

function publicGame(row: GameRow): PublicGame {
  return {
    ...row,
    // The database should already enforce this invariant. Repeating it at the
    // projection boundary prevents a stale/malformed row from leaking a
    // waiting game's private surface.
    puzzleSurface: row.status === 'WAITING' ? null : row.puzzleSurface,
  };
}

export async function getCurrentSnapshot(sql: Sql, _playerId?: string): Promise<PublicGameSnapshot | null> {
  const openRows = await sql<GameRow[]>`
    select
      id,
      status,
      puzzle_surface as "puzzleSurface",
      key_point_total as "keyPointTotal",
      discovered_key_point_count as "discoveredKeyPointCount",
      total_question_count as "totalQuestionCount",
      end_reason as "endReason",
      winner_player_id as "winnerPlayerId",
      created_at as "createdAt",
      activated_at as "activatedAt",
      ended_at as "endedAt",
      updated_at as "updatedAt"
    from api.games
    where status in ('WAITING', 'ACTIVE')
    order by created_at desc
    limit 1
  `;

  const endedRows = openRows[0]
    ? []
    : await sql<GameRow[]>`
      select
        id,
        status,
        puzzle_surface as "puzzleSurface",
        key_point_total as "keyPointTotal",
        discovered_key_point_count as "discoveredKeyPointCount",
        total_question_count as "totalQuestionCount",
        end_reason as "endReason",
        winner_player_id as "winnerPlayerId",
        created_at as "createdAt",
        activated_at as "activatedAt",
        ended_at as "endedAt",
        updated_at as "updatedAt"
      from api.games
      where status = 'ENDED'
      order by coalesce(ended_at, updated_at) desc, updated_at desc
      limit 1
    `;

  const row = openRows[0] ?? endedRows[0];
  if (!row) return null;

  const game = publicGame(row);
  const [stats, messages, events] = await Promise.all([
    sql<PlayerStatsRow[]>`
      select
        stats.game_id as "gameId",
        stats.player_id as "playerId",
        players.display_nickname as "displayNickname",
        players.lifetime_score as "lifetimeScore",
        stats.question_count as "questionCount",
        stats.yes_count as "yesCount",
        case
          when stats.question_count = 0 then null
          else stats.yes_count::double precision / stats.question_count
        end as "hitRate",
        stats.updated_at as "updatedAt",
        players.id,
        players.created_at as "createdAt"
      from api.game_player_stats stats
      join api.players players on players.id = stats.player_id
      where stats.game_id = ${game.id}
      order by players.display_nickname asc
    `,
    sql<PublicMessage[]>`
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
      where game_id = ${game.id}
      order by sequence_no asc
    `,
    sql<PublicGameEvent[]>`
      select
        id,
        game_id as "gameId",
        sequence_no as "sequenceNo",
        event_type as "eventType",
        player_id as "playerId",
        awarded_points as "awardedPoints",
        created_at as "createdAt"
      from api.game_events
      where game_id = ${game.id}
      order by sequence_no asc
    `,
  ]);

  let reveal: PublicGameReveal | null = null;
  if (game.status === 'ENDED') {
    const [revealRows, keyPoints] = await Promise.all([
      sql<RevealRow[]>`
        select full_solution as "fullSolution", revealed_at as "revealedAt"
        from api.game_reveals
        where game_id = ${game.id}
        limit 1
      `,
      sql<PublicRevealedKeyPoint[]>`
        select ordinal, content
        from api.revealed_key_points
        where game_id = ${game.id}
        order by ordinal asc
      `,
    ]);
    const revealRow = revealRows[0];
    if (revealRow) {
      reveal = {
        fullSolution: revealRow.fullSolution,
        revealedAt: revealRow.revealedAt,
        keyPoints: keyPoints.slice().sort(byOrdinal),
      };
    }
  }

  return {
    game,
    players: stats.map(({ id, displayNickname, lifetimeScore, createdAt }) => ({ id, displayNickname, lifetimeScore, createdAt })),
    messages: messages.slice().sort(bySequence),
    events: events.slice().sort(bySequence),
    stats: stats.map(({ id: _id, createdAt: _createdAt, ...playerStats }) => playerStats),
    reveal,
  };
}
