import type { ProgressSummaryInput, SemanticJudge } from '@turtle-soup/contracts';
import type { Sql } from 'postgres';
import { getWorkerDb, type WorkerTransaction } from '../db/client.js';
import {
  completeProgressSummary,
  markProgressSummaryStale,
  type CompleteProgressSummaryDependencies,
} from '../db/complete-progress-summary.js';
import {
  loadProgressSummaryBoundary,
  type ClaimedProgressSummaryJob,
} from '../db/progress-summary-queue.js';

export type ProgressSummaryProcessorDependencies = {
  judge: SemanticJudge;
  workerId: string;
  sql?: Sql;
  transaction?: WorkerTransaction;
  now?: Date;
};

export async function loadProgressSummaryInput(
  job: ClaimedProgressSummaryJob,
  dependencies: Pick<ProgressSummaryProcessorDependencies, 'sql'> = {},
): Promise<{ sourceFingerprint: string; throughSequenceNo: number; input: ProgressSummaryInput }> {
  const sql = dependencies.sql ?? getWorkerDb();
  const source = await loadProgressSummaryBoundary(sql, job.gameId, job.throughQuestionCount);
  return {
    sourceFingerprint: source.sourceFingerprint,
    throughSequenceNo: source.throughSequenceNo,
    input: { questions: source.questions },
  };
}

export async function processProgressSummary(
  job: ClaimedProgressSummaryJob,
  dependencies: ProgressSummaryProcessorDependencies,
): Promise<void> {
  const sql = dependencies.sql ?? getWorkerDb();
  const source = await loadProgressSummaryBoundary(sql, job.gameId, job.throughQuestionCount);
  if (source.sourceFingerprint !== job.sourceFingerprint || source.throughSequenceNo !== job.throughSequenceNo) {
    await markProgressSummaryStale(job, {
      transaction: dependencies.transaction,
      now: dependencies.now,
    });
    return;
  }

  const result = await dependencies.judge.summarizeProgress({ questions: source.questions });
  const completionDependencies: CompleteProgressSummaryDependencies = {
    transaction: dependencies.transaction,
    now: dependencies.now,
  };
  await completeProgressSummary({ job, result }, completionDependencies);
}
