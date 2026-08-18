import type { JudgeErrorCode, SemanticJudge } from '@turtle-soup/contracts';
import { loadWorkerConfig, type WorkerEnvironment } from './config.js';
import { recordJudgeAttempt as recordJudgeAttemptRow, type JudgeAttemptRecord } from './db/judge-attempts.js';
import { claimNextAction, claimNextExtraction, recordExtractionRetry, type ClaimedAction, type ClaimedExtraction } from './db/queue.js';
import { writeHeartbeat } from './db/heartbeat.js';
import { getWorkerDb, withWorkerTransaction, type WorkerTransaction } from './db/client.js';
import {
  claimNextProgressSummary,
  reconcileActiveGameProgressSummary,
  recordProgressSummaryRetry,
  type ClaimedProgressSummaryJob,
} from './db/progress-summary-queue.js';
import { createSemanticJudge, type JudgeRuntime } from './runtime/create-semantic-judge.js';
import { createAuditedSemanticJudge, type JudgeAttemptRecorder } from './runtime/audited-semantic-judge.js';
import { SemanticJudgeRuntimeError } from './runtime/semantic-judge.js';
import { JudgeValidationError } from './skills/validate-result.js';
import { processClaimedAction } from './processors/action-processor.js';
import { processExtraction as processClaimedExtraction } from './processors/extraction-processor.js';
import { processProgressSummary as processClaimedProgressSummary, type ProgressSummaryProcessorDependencies } from './processors/progress-summary-processor.js';
import { runWorker, type WorkerLoopOptions } from './worker.js';

export type StartWorkerDependencies = {
  judge?: SemanticJudge;
  runtime?: JudgeRuntime;
  runWorker?: (options: WorkerLoopOptions) => Promise<void>;
  writeHeartbeat?: (workerId: string, buildVersion: string) => Promise<void>;
  reconcileProgressSummary?: () => Promise<void>;
  startupReconcile?: () => Promise<void>;
  claimExtraction?: () => Promise<ClaimedExtraction | null>;
  claimAction?: () => Promise<ClaimedAction | null>;
  claimProgressSummary?: () => Promise<ClaimedProgressSummaryJob | null>;
  processExtraction?: (job: ClaimedExtraction) => Promise<void>;
  processAction?: (action: ClaimedAction) => Promise<void>;
  processProgressSummary?: (job: ClaimedProgressSummaryJob) => Promise<void>;
  processProgressSummaryJob?: (job: ClaimedProgressSummaryJob, dependencies: ProgressSummaryProcessorDependencies) => Promise<void>;
  recordProgressSummaryRetry?: (jobId: string, attempt: number, code: RetryCode) => Promise<void>;
  recordJudgeAttempt?: JudgeAttemptRecorder;
};

type RetryCode = Exclude<JudgeErrorCode, 'LEASE_LOST'>;

function retryCode(error: unknown): RetryCode | 'LEASE_LOST' | null {
  if (error instanceof SemanticJudgeRuntimeError) return error.code;
  if (error instanceof JudgeValidationError) return error.code;
  if (error instanceof Error && error.message === 'LEASE_LOST') return 'LEASE_LOST';
  return null;
}

export async function startWorker(
  env: WorkerEnvironment = process.env,
  dependencies: StartWorkerDependencies = {},
): Promise<void> {
  const config = loadWorkerConfig(env);
  const runtime = dependencies.judge ? undefined : dependencies.runtime ?? createSemanticJudge(config);
  const judge = dependencies.judge ?? runtime?.judge;
  if (!judge) throw new Error('JUDGE_RUNTIME_NOT_INITIALIZED');
  const recordAttempt = dependencies.recordJudgeAttempt ?? ((record: JudgeAttemptRecord) => recordJudgeAttemptRow(record));
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);

  const heartbeat = dependencies.writeHeartbeat
    ?? ((workerId: string, buildVersion: string) => writeHeartbeat(workerId, buildVersion));
  const workerTransaction: WorkerTransaction = (callback) => withWorkerTransaction(callback, config);
  const startupReconcile = dependencies.startupReconcile
    ?? dependencies.reconcileProgressSummary
    ?? (() => reconcileActiveGameProgressSummary(getWorkerDb(config)));
  const claimExtraction = dependencies.claimExtraction
    ?? (() => claimNextExtraction(config.workerId, new Date()));
  const claimAction = dependencies.claimAction
    ?? (() => claimNextAction(config.workerId, new Date()));
  const claimProgressSummary = dependencies.claimProgressSummary
    ?? (() => claimNextProgressSummary(config.workerId, new Date(), { transaction: workerTransaction }));
  const processExtraction = dependencies.processExtraction ?? (async (job: ClaimedExtraction) => {
    const jobJudge = runtime
      ? createAuditedSemanticJudge(runtime, { extractionJobId: job.id, attemptNo: job.attempt }, recordAttempt)
      : judge;
    try {
      await processClaimedExtraction(job, { judge: jobJudge, workerId: config.workerId });
    } catch (error) {
      const code = retryCode(error);
      if (!code || code === 'LEASE_LOST') throw error;
      await recordExtractionRetry(job.id, job.attempt, code);
    }
  });
  const processAction = dependencies.processAction ?? ((action: ClaimedAction) => {
    const actionJudge = runtime
      ? createAuditedSemanticJudge(runtime, { actionId: action.id, attemptNo: action.attempt }, recordAttempt)
      : judge;
    return processClaimedAction(action, {
      judge: actionJudge,
      workerId: config.workerId,
      challengeJudgeFactory: runtime && action.actionType === 'CHALLENGE'
        ? (attemptNo) => createAuditedSemanticJudge(runtime, { actionId: action.id, attemptNo }, recordAttempt)
        : undefined,
      challengeJudgeMetadata: runtime?.metadata['question-judge'],
    });
  });
  const processProgressSummary = dependencies.processProgressSummary ?? (async (job: ClaimedProgressSummaryJob) => {
    const jobJudge = runtime
      ? createAuditedSemanticJudge(runtime, { progressSummaryJobId: job.id, attemptNo: job.attempt }, recordAttempt)
      : judge;
    if (!jobJudge) throw new Error('JUDGE_RUNTIME_NOT_INITIALIZED');
    const runSummary = dependencies.processProgressSummaryJob ?? processClaimedProgressSummary;
    try {
      await runSummary(job, {
        judge: jobJudge,
        workerId: config.workerId,
        sql: getWorkerDb(config),
        transaction: workerTransaction,
      });
    } catch (error) {
      const code = retryCode(error);
      if (!code || code === 'LEASE_LOST') throw error;
      const recordRetry = dependencies.recordProgressSummaryRetry
        ?? ((jobId: string, attempt: number, retryCodeValue: RetryCode) => recordProgressSummaryRetry(jobId, attempt, retryCodeValue, {
          transaction: workerTransaction,
        }));
      await recordRetry(job.id, job.attempt, code);
    }
  });

  try {
    const runner = dependencies.runWorker ?? runWorker;
    await runner({
      heartbeat: () => heartbeat(config.workerId, config.buildVersion),
      startupReconcile,
      claimExtraction,
      claimAction,
      claimProgressSummary,
      processExtraction,
      processAction,
      processProgressSummary,
      signal: controller.signal,
    });
  } finally {
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
  }
}

if (process.argv[1]?.endsWith('main.js')) {
  startWorker().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
