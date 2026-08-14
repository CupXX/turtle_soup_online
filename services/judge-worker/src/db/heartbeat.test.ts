import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { writeHeartbeat } from './heartbeat.js';

describe('worker heartbeat', () => {
  it('upserts only safe worker liveness fields', async () => {
    const calls: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      calls.push(Array.from(strings).join(' '));
      return Promise.resolve([]);
    }) as unknown as Sql;

    await writeHeartbeat('worker-1', 'build-1', { sql });

    expect(calls[0].toLowerCase()).toContain('private.worker_heartbeats');
    expect(calls[0].toLowerCase()).toContain('on conflict');
    expect(calls[0].toLowerCase()).not.toContain('api_key');
  });
});
