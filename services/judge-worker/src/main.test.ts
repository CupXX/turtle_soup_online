import { describe, expect, it } from 'vitest';
import type { ClaimedAction, ClaimedExtraction } from './db/queue.js';
import type { ClaimedProgressSummaryJob } from './db/progress-summary-queue.js';
import { startWorker } from './main.js';

const env = {
  JUDGE_WORKER_DATABASE_URL: 'postgresql://worker:password@example.test:5432/game',
  JUDGE_PROVIDER: 'deepseek-harness',
  JUDGE_MODEL: 'deepseek-v4-flash',
  JUDGE_API_BASE_URL: 'http://127.0.0.1:4010/v1',
  JUDGE_API_KEY: 'not-a-real-key',
  JUDGE_TIMEOUT_MS: '30000',
  WORKER_ID: 'worker-1',
  BUILD_VERSION: 'test-build',
};

const extraction: ClaimedExtraction = {
  id: '00000000-0000-4000-8000-000000000001',
  gameId: '00000000-0000-4000-8000-000000000002',
  inputVersion: 1,
  attempt: 1,
  leaseOwner: 'worker-1',
  leaseExpiresAt: '2099-01-01T00:00:00.000Z',
};

const action: ClaimedAction = {
  id: '00000000-0000-4000-8000-000000000003',
  gameId: extraction.gameId,
  playerId: '00000000-0000-4000-8000-000000000004',
  sequenceNo: 1,
  actionType: 'NORMAL_MESSAGE',
  attempt: 1,
  leaseOwner: 'worker-1',
  leaseExpiresAt: extraction.leaseExpiresAt,
};

const summaryJob: ClaimedProgressSummaryJob = {
  id: '00000000-0000-4000-8000-000000000005',
  gameId: extraction.gameId,
  throughQuestionCount: 10,
  throughSequenceNo: 10,
  sourceFingerprint: 'a'.repeat(64),
  attempt: 1,
  leaseOwner: 'worker-1',
  leaseExpiresAt: extraction.leaseExpiresAt,
};

describe('startWorker', () => {
  it('validates configuration, starts heartbeat, prioritizes extraction, and dispatches normal actions', async () => {
    const order: string[] = [];
    await startWorker(env, {
      judge: {} as never,
      writeHeartbeat: async () => { order.push('heartbeat'); },
      claimExtraction: async () => { order.push('claim-extraction'); return extraction; },
      claimAction: async () => { order.push('claim-action'); return action; },
      processExtraction: async () => { order.push('process-extraction'); },
      processAction: async () => { order.push('process-action'); },
      runWorker: async (options) => {
        await options.heartbeat();
        const job = await options.claimExtraction();
        if (job) await options.processExtraction?.(job);
        const next = await options.claimAction();
        if (next) await options.processAction?.(next);
      },
    });

    expect(order).toEqual([
      'heartbeat',
      'claim-extraction',
      'process-extraction',
      'claim-action',
      'process-action',
    ]);
  });

  it('aborts the worker loop on SIGTERM and removes the signal listener', async () => {
    let signal: AbortSignal | undefined;
    await startWorker(env, {
      judge: {} as never,
      runWorker: async (options) => {
        signal = options.signal;
        process.emit('SIGTERM');
        expect(signal?.aborted).toBe(true);
      },
    });

    expect(signal?.aborted).toBe(true);
  });

  it('wires default startup reconciliation and the separate summary queue', async () => {
    const order: string[] = [];
    await startWorker(env, {
      judge: {} as never,
      writeHeartbeat: async () => undefined,
      reconcileProgressSummary: async () => { order.push('reconcile'); },
      claimProgressSummary: async () => { order.push('claim-summary'); return summaryJob; },
      processProgressSummary: async (job) => { order.push(`process-summary:${job.id}`); },
      runWorker: async (options) => {
        await options.heartbeat();
        await options.startupReconcile?.();
        const job = await options.claimProgressSummary?.();
        if (job) await options.processProgressSummary?.(job);
      },
    });

    expect(order).toEqual(['reconcile', 'claim-summary', `process-summary:${summaryJob.id}`]);
  });

  it('creates the progress-summary audit parent for the default processor', async () => {
    const records: Array<{ skill: string; parent: unknown }> = [];
    let receivedSkill = '';
    await startWorker(env, {
      runtime: {
        judge: {
          extractKeyPoints: async () => ({ key_points: [] }),
          judgeQuestion: async () => ({ verdict: 'NO', fully_covered_key_point_ids: [] }),
          judgeFinalAnswer: async () => ({ covered_key_point_ids: [] }),
          summarizeProgress: async () => ({ confirmed_facts: [], ruled_out_facts: [], irrelevant_topics: [] }),
        },
        metadata: {},
      } as never,
      writeHeartbeat: async () => undefined,
      reconcileProgressSummary: async () => undefined,
      claimProgressSummary: async () => summaryJob,
      processProgressSummaryJob: async (_job, dependencies) => {
        receivedSkill = 'progress-summary';
        await dependencies.judge.summarizeProgress({ questions: [] });
      },
      recordJudgeAttempt: async (record) => { records.push({ skill: record.skill, parent: record.parent }); },
      runWorker: async (options) => {
        await options.startupReconcile?.();
        const job = await options.claimProgressSummary?.();
        if (job) await options.processProgressSummary?.(job);
      },
    });

    expect(receivedSkill).toBe('progress-summary');
    expect(records).toEqual([{
      skill: 'progress-summary',
      parent: { progressSummaryJobId: summaryJob.id, attemptNo: summaryJob.attempt },
    }]);
  });
});
