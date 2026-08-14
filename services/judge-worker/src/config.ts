export type WorkerEnvironment = Record<string, string | undefined>;

export type WorkerConfig = {
  databaseUrl: string;
  provider: string;
  model: string;
  apiBaseUrl: string;
  apiKey: string;
  timeoutMs: number;
  workerId: string;
  buildVersion: string;
};

function required(env: WorkerEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadWorkerConfig(env: WorkerEnvironment = process.env): WorkerConfig {
  const databaseUrl = required(env, 'JUDGE_WORKER_DATABASE_URL');
  const apiBaseUrl = required(env, 'JUDGE_API_BASE_URL');
  try {
    new URL(databaseUrl);
    new URL(apiBaseUrl);
  } catch {
    throw new Error('JUDGE_WORKER_DATABASE_URL and JUDGE_API_BASE_URL must be valid URLs');
  }

  const timeoutText = required(env, 'JUDGE_TIMEOUT_MS');
  const timeoutMs = Number(timeoutText);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('JUDGE_TIMEOUT_MS must be a positive integer');
  }

  return {
    databaseUrl,
    provider: required(env, 'JUDGE_PROVIDER'),
    model: required(env, 'JUDGE_MODEL'),
    apiBaseUrl,
    apiKey: required(env, 'JUDGE_API_KEY'),
    timeoutMs,
    workerId: required(env, 'WORKER_ID'),
    buildVersion: required(env, 'BUILD_VERSION'),
  };
}
