import type { KeyPointExtractionInput, SemanticJudge } from '@turtle-soup/contracts';
import type { Sql } from 'postgres';
import { getWorkerDb, type WorkerTransaction } from '../db/client.js';
import { completeExtraction, type CompleteExtractionDependencies } from '../db/complete-extraction.js';
import type { ClaimedExtraction } from '../db/queue.js';

type ExtractionInputRow = {
  puzzleSurface: string;
  fullSolution: string;
  inputVersion: number;
};

export type ExtractionProcessorDependencies = {
  judge: SemanticJudge;
  workerId: string;
  sql?: Sql;
  transaction?: WorkerTransaction;
  idFactory?: () => string;
};

export class ExtractionInputNotFoundError extends Error {
  constructor() {
    super('EXTRACTION_INPUT_NOT_FOUND');
    this.name = 'ExtractionInputNotFoundError';
  }
}

export async function loadExtractionInput(
  job: ClaimedExtraction,
  dependencies: Pick<ExtractionProcessorDependencies, 'sql'> = {},
): Promise<KeyPointExtractionInput> {
  const sql = dependencies.sql ?? getWorkerDb();
  const rows = await sql<ExtractionInputRow[]>`
    select
      puzzle_surface as "puzzleSurface",
      full_solution as "fullSolution",
      input_version as "inputVersion"
    from private.game_secrets
    where game_id = ${job.gameId}
      and input_version = ${job.inputVersion}
  `;
  const input = rows[0];
  if (!input || input.inputVersion !== job.inputVersion) {
    throw new ExtractionInputNotFoundError();
  }
  return {
    puzzle_surface: input.puzzleSurface,
    full_solution: input.fullSolution,
  };
}

export async function processExtraction(
  job: ClaimedExtraction,
  dependencies: ExtractionProcessorDependencies,
): Promise<void> {
  const input = await loadExtractionInput(job, dependencies);
  const result = await dependencies.judge.extractKeyPoints(input);
  const completionDependencies: CompleteExtractionDependencies = {
    transaction: dependencies.transaction,
    idFactory: dependencies.idFactory,
  };
  await completeExtraction({
    jobId: job.id,
    gameId: job.gameId,
    inputVersion: job.inputVersion,
    workerId: dependencies.workerId,
    keyPoints: result.key_points,
  }, completionDependencies);
}
