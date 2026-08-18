import type { HarnessSkill } from './runtime/semantic-judge.js';

export type WorkerEnvironment = Record<string, string | undefined>;

export type ReasoningEffort = 'off' | 'none' | 'low' | 'medium' | 'high' | 'max';
export type SkillJudgeConfig = { model: string; reasoningEffort: ReasoningEffort };

export type WorkerConfig = {
  databaseUrl: string;
  provider: string;
  apiBaseUrl: string;
  apiKey: string;
  timeoutMs: number;
  workerId: string;
  buildVersion: string;
  skillConfigs: Record<HarnessSkill, SkillJudgeConfig>;
};

function required(env: WorkerEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(env: WorkerEnvironment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function reasoningEffort(env: WorkerEnvironment, name: string): ReasoningEffort {
  const value = optional(env, name) ?? 'off';
  const allowed: readonly ReasoningEffort[] = ['off', 'none', 'low', 'medium', 'high', 'max'];
  if (!allowed.includes(value as ReasoningEffort)) {
    throw new Error(`${name} must be one of off, none, low, medium, high, max`);
  }
  return value as ReasoningEffort;
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

  const provider = required(env, 'JUDGE_PROVIDER');
  const model = required(env, 'JUDGE_MODEL');
  const skillConfigs: Record<HarnessSkill, SkillJudgeConfig> = {
    'key-point-extraction': {
      model: optional(env, 'JUDGE_KEY_POINT_EXTRACTION_MODEL') ?? model,
      reasoningEffort: reasoningEffort(env, 'JUDGE_KEY_POINT_EXTRACTION_REASONING_EFFORT'),
    },
    'question-judge': {
      model: optional(env, 'JUDGE_QUESTION_MODEL') ?? model,
      reasoningEffort: reasoningEffort(env, 'JUDGE_QUESTION_REASONING_EFFORT'),
    },
    'final-answer-judge': {
      model: optional(env, 'JUDGE_FINAL_ANSWER_MODEL') ?? model,
      reasoningEffort: reasoningEffort(env, 'JUDGE_FINAL_ANSWER_REASONING_EFFORT'),
    },
    'progress-summary': {
      model: optional(env, 'JUDGE_PROGRESS_SUMMARY_MODEL') ?? model,
      reasoningEffort: reasoningEffort(env, 'JUDGE_PROGRESS_SUMMARY_REASONING_EFFORT'),
    },
  };

  return {
    databaseUrl,
    provider,
    apiBaseUrl,
    apiKey: provider === 'openai-responses'
      ? (optional(env, 'OPENAI_API_KEY') ?? required(env, 'JUDGE_API_KEY'))
      : required(env, 'JUDGE_API_KEY'),
    timeoutMs,
    workerId: required(env, 'WORKER_ID'),
    buildVersion: required(env, 'BUILD_VERSION'),
    skillConfigs,
  };
}
