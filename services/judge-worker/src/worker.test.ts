import { describe, expect, it } from 'vitest';
import { runWorker } from './worker.js';

describe('worker loop', () => {
  it('polls extraction before actions and stops on abort without holding a lease', async () => {
    const controller = new AbortController();
    const order: string[] = [];

    await runWorker({
      signal: controller.signal,
      heartbeat: async () => { order.push('heartbeat'); },
      claimExtraction: async () => { order.push('extraction'); return null; },
      claimAction: async () => { order.push('action'); return null; },
      sleep: async () => {
        order.push('sleep');
        controller.abort();
      },
    });

    expect(order).toEqual(['heartbeat', 'extraction', 'action', 'sleep']);
  });
});
