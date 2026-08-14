import type { Sql } from 'postgres';
import { getWorkerDb } from './client.js';

export type HeartbeatDependencies = { sql?: Sql };

export async function writeHeartbeat(
  workerId: string,
  buildVersion: string,
  dependencies: HeartbeatDependencies = {},
): Promise<void> {
  if (!workerId.trim() || !buildVersion.trim()) {
    throw new Error('workerId and buildVersion are required');
  }

  const sql = dependencies.sql ?? getWorkerDb();
  await sql`
    insert into private.worker_heartbeats
      (worker_id, started_at, last_seen_at, build_version)
    values (${workerId}, now(), now(), ${buildVersion})
    on conflict (worker_id) do update
      set last_seen_at = now(),
          build_version = excluded.build_version
  `;
}
