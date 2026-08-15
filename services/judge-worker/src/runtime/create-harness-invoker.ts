import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { HarnessInvoker, HarnessInvocation } from './semantic-judge.js';
import { SemanticJudgeRuntimeError } from './semantic-judge.js';
import type { ReasoningEffort, WorkerConfig } from '../config.js';

type ChildResult = { code: number; stdout: string; stderr: string };

export type HarnessInvokerDependencies = {
  tempDirectory?: () => Promise<string>;
  profilePatchPath?: string;
  reasoningPatchPath?: string;
  entryPoint?: string;
};

type HarnessInvokerConfig = Pick<WorkerConfig, 'apiBaseUrl' | 'apiKey' | 'timeoutMs'> & {
  model: string;
  reasoningEffort?: ReasoningEffort;
};

export function resolveHarnessEntryPoint(): string {
  try {
    return createRequire(import.meta.url).resolve('@deepseek-ai/dsh/lib/bin.js');
  } catch {
    // Keep a cwd fallback for bundled layouts that do not preserve package resolution.
  }
  const cwd = process.cwd();
  return resolve(cwd, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
}

function defaultProfilePatchPath(): string {
  const configured = process.env.HARNESS_PROFILE_PATCH_PATH;
  if (configured) return configured;
  const candidates = [
    resolve(process.cwd(), 'spikes/deepseek-harness/profile.patch.yml'),
    resolve(process.cwd(), '../spikes/deepseek-harness/profile.patch.yml'),
    resolve(process.cwd(), '../../spikes/deepseek-harness/profile.patch.yml'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function defaultReasoningPatchPath(reasoningEffort: ReasoningEffort): string | undefined {
  if (reasoningEffort === 'off') return undefined;
  const fileName = reasoningEffort === 'high' ? 'reasoning-high.patch.yml' : 'reasoning-max.patch.yml';
  const candidates = [
    resolve(process.cwd(), `spikes/deepseek-harness/${fileName}`),
    resolve(process.cwd(), `../spikes/deepseek-harness/${fileName}`),
    resolve(process.cwd(), `../../spikes/deepseek-harness/${fileName}`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function collectChildOutput(child: ChildProcess): Promise<ChildResult> {
  return new Promise((resolvePromise, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => resolvePromise({
      code: code ?? 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

function parseOutput(stdout: string): unknown {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // Ignore launcher diagnostics and parse the final JSON value.
    }
  }
  throw new SemanticJudgeRuntimeError('TRANSPORT_ERROR', 'Harness did not return one JSON value');
}

function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'turtle-soup-harness-worker-'));
}

export function createHarnessInvoker(
  config: HarnessInvokerConfig,
  dependencies: HarnessInvokerDependencies = {},
): HarnessInvoker {
  const entryPoint = dependencies.entryPoint ?? resolveHarnessEntryPoint();
  const profilePatchPath = dependencies.profilePatchPath ?? defaultProfilePatchPath();
  const reasoningEffort = config.reasoningEffort ?? 'off';
  const reasoningPatchPath = dependencies.reasoningPatchPath ?? defaultReasoningPatchPath(reasoningEffort);
  const profilePatchPaths = [profilePatchPath, ...(reasoningPatchPath ? [reasoningPatchPath] : [])];
  const makeHome = dependencies.tempDirectory ?? tempHome;

  return async (request: HarnessInvocation): Promise<unknown> => {
    const runtimeHome = await makeHome();
    const timeoutMs = Math.max(1, Math.min(request.timeoutMs, config.timeoutMs));
    const task = JSON.stringify({
      purpose: 'turtle-soup-semantic-judge',
      skill: request.skill,
      prompt: request.prompt,
      output_schema: request.schema,
      model: config.model,
    });
    try {
      await writeFile(join(runtimeHome, 'output-schema.json'), JSON.stringify(request.schema), 'utf8');
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        DSH_HOME: runtimeHome,
        DSH_CWD: runtimeHome,
        DSH_PERMISSION_MODE: 'read-only',
        DSH_TELEMETRY_MODE: 'DISABLED',
        DEEPSEEK_API_KEY: config.apiKey,
        DEEPSEEK_BASE_URL: config.apiBaseUrl,
        DEEPSEEK_MODEL: config.model,
        TURTLE_SOUP_HARNESS_MODEL: config.model,
        OPENAI_API_KEY: config.apiKey,
        OPENAI_BASE_URL: config.apiBaseUrl,
        OPENAI_MODEL: config.model,
      };
      const child = await runChildWithProfile(entryPoint, profilePatchPaths, task, environment, runtimeHome, timeoutMs);
      if (child.code !== 0) {
        throw new SemanticJudgeRuntimeError('TRANSPORT_ERROR', child.stderr || child.stdout || `Harness exited with ${child.code}`);
      }
      return parseOutput(child.stdout);
    } finally {
      await rm(runtimeHome, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    }
  };
}

async function runChildWithProfile(
  entryPoint: string,
  profilePatchPaths: string[],
  task: string,
  environment: NodeJS.ProcessEnv,
  cwd: string,
  timeoutMs: number,
): Promise<ChildResult> {
  const patchArgs = profilePatchPaths.flatMap((path) => ['--patch', path]);
  const child = spawn(process.execPath, [entryPoint, '--profile', 'headless', ...patchArgs, task], {
    cwd,
    env: environment,
    shell: false,
    windowsHide: true,
  });
  const result = collectChildOutput(child);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutError = new SemanticJudgeRuntimeError('TIMEOUT', 'Harness invocation timed out');
  try {
    return await new Promise<ChildResult>((resolvePromise, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        void (async () => {
          child.kill('SIGTERM');
          killTimer = setTimeout(() => reject(timeoutError), 1_000);
        })();
      }, timeoutMs);
      result.then(
        (value) => (timedOut ? reject(timeoutError) : resolvePromise(value)),
        (error) => reject(timedOut ? timeoutError : error),
      );
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
  }
}
