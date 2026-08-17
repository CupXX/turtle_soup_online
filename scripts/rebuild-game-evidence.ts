import { loadWorkerConfig } from '../services/judge-worker/src/config.js';
import { withWorkerTransaction } from '../services/judge-worker/src/db/client.js';
import { rebuildEvidenceProgressInTransaction } from '../services/judge-worker/src/db/rebuild-evidence-progress.js';

const gameId = process.argv[2];
if (!gameId) throw new Error('usage: rebuild-game-evidence <game-id>');

async function main(): Promise<void> {
  loadWorkerConfig();
  await withWorkerTransaction(async (sql) => {
    const games = await sql<{ id: string; status: string }[]>`
      select id, status from api.games where id = ${gameId} for update
    `;
    if (games[0]?.status !== 'ACTIVE') throw new Error('GAME_NOT_ACTIVE');
    await rebuildEvidenceProgressInTransaction(sql, gameId);
  });
  console.log(JSON.stringify({ gameId, rebuilt: true }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
