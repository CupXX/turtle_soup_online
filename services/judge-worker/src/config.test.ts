import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from './config.js';

const validEnv = {
  JUDGE_WORKER_DATABASE_URL: 'postgresql://worker:password@example.test:5432/game',
  JUDGE_PROVIDER: 'deepseek-harness',
  JUDGE_MODEL: 'deepseek-chat',
  JUDGE_API_BASE_URL: 'http://127.0.0.1:4010/v1',
  JUDGE_API_KEY: 'not-a-real-key',
  JUDGE_TIMEOUT_MS: '30000',
  WORKER_ID: 'worker-local-1',
  BUILD_VERSION: 'dev',
};

describe('worker configuration', () => {
  it('parses the server-only configuration and timeout', () => {
    expect(loadWorkerConfig(validEnv)).toEqual({
      databaseUrl: validEnv.JUDGE_WORKER_DATABASE_URL,
      provider: validEnv.JUDGE_PROVIDER,
      model: validEnv.JUDGE_MODEL,
      apiBaseUrl: validEnv.JUDGE_API_BASE_URL,
      apiKey: validEnv.JUDGE_API_KEY,
      timeoutMs: 30000,
      workerId: validEnv.WORKER_ID,
      buildVersion: validEnv.BUILD_VERSION,
    });
  });

  it('rejects missing or non-positive timeout before startup', () => {
    const missing: Record<string, string | undefined> = { ...validEnv };
    delete missing.JUDGE_API_KEY;
    expect(() => loadWorkerConfig(missing)).toThrow(/JUDGE_API_KEY/);

    expect(() => loadWorkerConfig({ ...validEnv, JUDGE_TIMEOUT_MS: '0' })).toThrow(/JUDGE_TIMEOUT_MS/);
  });
});
