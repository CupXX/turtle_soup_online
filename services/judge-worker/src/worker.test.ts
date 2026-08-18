import { describe, expect, it } from 'vitest';
import type { ClaimedProgressSummaryJob } from './db/progress-summary-queue.js';
import { runWorker } from './worker.js';

const summaryJob: ClaimedProgressSummaryJob = {
  id: '00000000-0000-4000-8000-000000000005',
  gameId: '00000000-0000-4000-8000-000000000002',
  throughQuestionCount: 10,
  throughSequenceNo: 10,
  sourceFingerprint: 'a'.repeat(64),
  attempt: 1,
  leaseOwner: 'worker-1',
  leaseExpiresAt: '2099-01-01T00:00:00.000Z',
};

describe('worker loop', () => {
  it('runs startup reconciliation after heartbeat, then polls extraction before actions and summary', async () => {
    const controller = new AbortController();
    const order: string[] = [];
    let summaryClaimed = false;

    await runWorker({
      signal: controller.signal,
      heartbeat: async () => { order.push('heartbeat'); },
      startupReconcile: async () => { order.push('reconcile'); },
      claimExtraction: async () => { order.push('extraction'); return null; },
      claimAction: async () => { order.push('action'); return null; },
      claimProgressSummary: async () => {
        order.push('summary');
        if (summaryClaimed) return null;
        summaryClaimed = true;
        return summaryJob;
      },
      processProgressSummary: async () => {
        order.push('process-summary');
        controller.abort();
      },
      sleep: async () => {
        order.push('sleep');
        controller.abort();
      },
    });

    expect(order).toEqual(['heartbeat', 'reconcile', 'extraction', 'action', 'summary', 'process-summary']);
  });

  it('keeps missing startup and summary callbacks as safe no-ops', async () => {
    const controller = new AbortController();
    await expect(runWorker({
      signal: controller.signal,
      heartbeat: async () => undefined,
      claimExtraction: async () => null,
      claimAction: async () => null,
      sleep: async () => { controller.abort(); },
    })).resolves.toBeUndefined();
  });
});
