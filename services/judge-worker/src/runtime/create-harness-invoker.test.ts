import { createServer } from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHarnessInvoker, resolveHarnessEntryPoint } from './create-harness-invoker.js';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function provider(output: unknown, delayMs = 0) {
  const requests: Array<Record<string, unknown>> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(output) }, finish_reason: null }]})}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }]})}\n\ndata: [DONE]\n\n`;
      setTimeout(() => response.writeHead(200, { 'content-type': 'text/event-stream' }).end(body), delayMs);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('provider did not listen');
  return { url: `http://127.0.0.1:${address.port}`, requests };
}

const config = {
  databaseUrl: 'postgresql://worker:password@example.test:5432/game',
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  apiBaseUrl: 'http://127.0.0.1:1',
  apiKey: 'test-key',
  timeoutMs: 30_000,
  workerId: 'worker-1',
  buildVersion: 'test-build',
};

describe('createHarnessInvoker', () => {
  it('resolves DSH from the worker package when the process cwd has no node_modules', async () => {
    const isolatedDirectory = await mkdtemp(join(tmpdir(), 'turtle-soup-worker-cwd-'));
    const previousDirectory = process.cwd();
    process.chdir(isolatedDirectory);
    try {
      await expect(stat(resolveHarnessEntryPoint())).resolves.toMatchObject({ isFile: expect.any(Function) });
      expect(resolveHarnessEntryPoint()).not.toContain(isolatedDirectory);
      expect(resolveHarnessEntryPoint()).toMatch(/[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/);
    } finally {
      process.chdir(previousDirectory);
      await rm(isolatedDirectory, { recursive: true, force: true });
    }
  });

  it('uses one fresh headless session with no model-facing tools and cleans its home', async () => {
    const mock = await provider({ verdict: 'YES' });
    const homes: string[] = [];
    const invoker = createHarnessInvoker({ ...config, apiBaseUrl: mock.url }, {
      tempDirectory: async () => {
        const home = await mkdtemp(join(tmpdir(), 'turtle-soup-worker-test-'));
        homes.push(home);
        return home;
      },
    });

    await expect(invoker({
      skill: 'question-judge',
      prompt: 'judge this question',
      schema: { type: 'object' },
      timeoutMs: 30_000,
    })).resolves.toEqual({ verdict: 'YES' });

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].tools ?? []).toEqual([]);
    expect(mock.requests[0].thinking).toEqual({ type: 'disabled' });
    expect(mock.requests[0].model).toBe('deepseek-v4-flash');
    await expect(stat(homes[0])).rejects.toThrow();
  }, 40_000);

  it('applies the selected reasoning overlay and model independently', async () => {
    const mock = await provider({ verdict: 'YES' });
    const highInvoker = createHarnessInvoker({ ...config, apiBaseUrl: mock.url, model: 'deepseek-v4-pro', reasoningEffort: 'high' });
    const maxInvoker = createHarnessInvoker({ ...config, apiBaseUrl: mock.url, model: 'deepseek-v4-pro', reasoningEffort: 'max' });

    await highInvoker({ skill: 'question-judge', prompt: 'high', schema: { type: 'object' }, timeoutMs: 30_000 });
    await maxInvoker({ skill: 'question-judge', prompt: 'max', schema: { type: 'object' }, timeoutMs: 30_000 });

    expect(mock.requests[0].model).toBe('deepseek-v4-pro');
    expect(mock.requests[0].reasoning_effort).toBe('high');
    expect(mock.requests[1].model).toBe('deepseek-v4-pro');
    expect(mock.requests[1].reasoning_effort).toBe('max');
  }, 90_000);

  it('kills a hung Harness process and maps the timeout', async () => {
    const mock = await provider({ verdict: 'YES' }, 2_000);
    const invoker = createHarnessInvoker({ ...config, apiBaseUrl: mock.url, timeoutMs: 1_000 });

    await expect(invoker({
      skill: 'question-judge',
      prompt: 'judge this question',
      schema: { type: 'object' },
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
