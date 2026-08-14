import type { TransactionSql } from 'postgres';

type OpenGameRow = { id: string };

export async function joinCurrentGame(sql: TransactionSql, playerId: string): Promise<{ gameId: string } | null> {
  const rows = await sql<OpenGameRow[]>`
    select id
    from api.games
    where status in ('WAITING', 'ACTIVE')
    order by created_at desc
    limit 1
    for update
  `;
  const game = rows[0];
  if (!game) return null;

  await sql`
    insert into api.game_player_stats
      (game_id, player_id, question_count, yes_count, updated_at)
    values (${game.id}, ${playerId}, 0, 0, now())
    on conflict (game_id, player_id) do nothing
  `;

  return { gameId: game.id };
}
