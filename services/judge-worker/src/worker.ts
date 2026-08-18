import type { ClaimedAction, ClaimedExtraction } from './db/queue.js';
import type { ClaimedProgressSummaryJob } from './db/progress-summary-queue.js';

export type WorkerLoopOptions = {
  heartbeat: () => Promise<void>;
  startupReconcile?: () => Promise<void>;
  claimExtraction: () => Promise<ClaimedExtraction | null>;
  claimAction: () => Promise<ClaimedAction | null>;
  claimProgressSummary?: () => Promise<ClaimedProgressSummaryJob | null>;
  processExtraction?: (job: ClaimedExtraction) => Promise<void>;
  processAction?: (action: ClaimedAction) => Promise<void>;
  processProgressSummary?: (job: ClaimedProgressSummaryJob) => Promise<void>;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  idleDelayMs?: number;
  heartbeatIntervalMs?: number;
};

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runWorker(options: WorkerLoopOptions): Promise<void> {
  const signal = options.signal;
  const sleep = options.sleep ?? defaultSleep;
  const idleDelayMs = options.idleDelayMs ?? 250;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;

  await options.heartbeat();
  await options.startupReconcile?.();
  const heartbeatTimer = setInterval(() => {
    void options.heartbeat().catch(() => undefined);
  }, heartbeatIntervalMs);

  try {
    while (!signal?.aborted) {
      const extraction = await options.claimExtraction();
      if (extraction) {
        if (!options.processExtraction) throw new Error('processExtraction is required for a claimed job');
        await options.processExtraction(extraction);
        continue;
      }

      const action = await options.claimAction();
      if (action) {
        if (!options.processAction) throw new Error('processAction is required for a claimed action');
        await options.processAction(action);
        continue;
      }

      const progressSummary = await options.claimProgressSummary?.();
      if (progressSummary) {
        if (!options.processProgressSummary) throw new Error('processProgressSummary is required for a claimed summary');
        await options.processProgressSummary(progressSummary);
        continue;
      }

      await sleep(idleDelayMs);
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
}
