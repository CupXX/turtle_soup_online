import { randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { withWorkerTransaction, type WorkerTransaction } from './client.js';

export type CompleteExtractionInput = {
  jobId: string;
  gameId: string;
  inputVersion: number;
  workerId: string;
  keyPoints: Array<{ content: string; evidence: Array<{ content: string }> }>;
};

export type CompleteExtractionDependencies = {
  transaction?: WorkerTransaction;
  idFactory?: () => string;
  now?: Date;
};

type ExtractionJobRow = {
  id: string;
  gameId: string;
  inputVersion: number;
  status: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
};

type GameRow = {
  id: string;
  status: string;
  puzzleSurface: string | null;
};

type SecretRow = {
  gameId: string;
  inputVersion: number;
  puzzleSurface: string;
};

function transactionFor(dependencies: CompleteExtractionDependencies): WorkerTransaction {
  return dependencies.transaction ?? withWorkerTransaction;
}

function idFactoryFor(dependencies: CompleteExtractionDependencies): () => string {
  return dependencies.idFactory ?? randomUUID;
}

type NormalizedKeyPoint = { content: string; evidence: string[] };

function normalizeKeyPoints(keyPoints: CompleteExtractionInput['keyPoints']): NormalizedKeyPoint[] {
  if (keyPoints.length < 3 || keyPoints.length > 5) {
    throw new Error('key points must contain three to five items');
  }

  const contents = keyPoints.map((point) => {
    const content = point.content.normalize('NFKC').trim();
    if (!content || content.length > 2000) {
      throw new Error('key point content is invalid');
    }
    if (point.evidence.length < 1 || point.evidence.length > 4) {
      throw new Error('key point evidence must contain one to four items');
    }
    const evidence = point.evidence.map(({ content: rawContent }) => {
      const evidenceContent = rawContent.normalize('NFKC').trim();
      if (!evidenceContent || evidenceContent.length > 2000) throw new Error('key point evidence content is invalid');
      return evidenceContent;
    });
    const normalizedEvidence = evidence.map((item) => item.toLocaleLowerCase('zh-CN'));
    if (new Set(normalizedEvidence).size !== normalizedEvidence.length) {
      throw new Error('key point evidence must be unique');
    }
    return { content, evidence };
  });
  const normalized = contents.map(({ content }) => content.toLocaleLowerCase('zh-CN'));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('key points must be unique');
  }
  return contents;
}

function activeLease(job: ExtractionJobRow, workerId: string, now: Date): boolean {
  if (job.status !== 'PROCESSING' || job.leaseOwner !== workerId || !job.leaseExpiresAt) return false;
  return new Date(job.leaseExpiresAt).getTime() > now.getTime();
}

export async function completeExtraction(
  input: CompleteExtractionInput,
  dependencies: CompleteExtractionDependencies = {},
): Promise<void> {
  const contents = normalizeKeyPoints(input.keyPoints);
  const makeId = idFactoryFor(dependencies);
  const now = dependencies.now ?? new Date();

  await transactionFor(dependencies)(async (sql) => {
    const jobs = await sql<ExtractionJobRow[]>`
      select
        id,
        game_id as "gameId",
        input_version as "inputVersion",
        status,
        lease_owner as "leaseOwner",
        lease_expires_at as "leaseExpiresAt"
      from private.key_point_extraction_jobs
      where id = ${input.jobId}
      for update
    `;
    const job = jobs[0];
    if (!job || job.gameId !== input.gameId || job.inputVersion !== input.inputVersion || !activeLease(job, input.workerId, now)) {
      return;
    }

    const games = await sql<GameRow[]>`
      select id, status, puzzle_surface as "puzzleSurface"
      from api.games
      where id = ${input.gameId}
      for update
    `;
    const game = games[0];
    if (!game || game.status !== 'WAITING') return;

    // The game row lock above serializes preparation replacement. The worker
    // only reads the secret and therefore must not need UPDATE on this table.
    const secrets = await sql<SecretRow[]>`
      select game_id as "gameId", input_version as "inputVersion", puzzle_surface as "puzzleSurface"
      from private.game_secrets
      where game_id = ${input.gameId}
    `;
    const secret = secrets[0];
    if (!secret || secret.inputVersion !== input.inputVersion) return;

    for (const [index, point] of contents.entries()) {
      const keyPointId = makeId();
      await sql`
        insert into private.key_points
          (id, game_id, ordinal, content, created_at)
        values (${keyPointId}, ${input.gameId}, ${index + 1}, ${point.content}, now())
      `;
      for (const [evidenceIndex, content] of point.evidence.entries()) {
        await sql`
          insert into private.key_point_evidence
            (id, key_point_id, ordinal, content, created_at)
          values (${makeId()}, ${keyPointId}, ${evidenceIndex + 1}, ${content}, now())
        `;
      }
    }

    await sql`
      update api.games
      set status = 'ACTIVE',
          puzzle_surface = ${secret.puzzleSurface},
          key_point_total = ${contents.length},
          discovered_key_point_count = 0,
          activated_at = now(),
          updated_at = now()
      where id = ${input.gameId} and status = 'WAITING'
    `;
    await sql`
      update private.key_point_extraction_jobs
      set status = 'COMPLETED',
          lease_owner = null,
          lease_expires_at = null,
          error_code = null,
          updated_at = now()
      where id = ${input.jobId}
        and status = 'PROCESSING'
        and lease_owner = ${input.workerId}
    `;
  });
}
