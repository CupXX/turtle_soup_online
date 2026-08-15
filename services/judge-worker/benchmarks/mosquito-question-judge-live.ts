import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { JudgeVerdict, QuestionJudgeInput, QuestionJudgeResult } from '@turtle-soup/contracts';
import { createHarnessInvoker } from '../src/runtime/create-harness-invoker.js';
import { HarnessSemanticJudge } from '../src/runtime/harness-semantic-judge.js';
import { SemanticJudgeRuntimeError } from '../src/runtime/semantic-judge.js';
import { QUESTION_JUDGE_PROMPT_VERSION } from '../src/skills/question-judge.js';
import type {
  JudgeResultWithUsage,
  QuestionJudgeGoldCase,
  QuestionJudgeGoldFixture,
  RegressionAttempt,
  RegressionResultsDocument,
} from './question-judge-regression.js';
import {
  evaluateAttempt,
  classifyFailure,
  loadQuestionJudgeFixture,
  renderRegressionReport,
  renderVersionComparison,
  serializeRegressionResults,
  summarizeAttempts,
} from './question-judge-regression.js';
import { OpenAIResponsesSemanticJudge, type OpenAIReasoningEffort } from './openai-responses-semantic-judge.js';

export const FIXED_KEY_POINTS = [
  { label: 'KP1', id: '00000000-0000-4000-8000-000000000101', content: '他半夜醒来是因为被蚊子叮醒。' },
  { label: 'KP2', id: '00000000-0000-4000-8000-000000000102', content: '他打自己一巴掌是为了拍蚊子，但没有打着。' },
  { label: 'KP3', id: '00000000-0000-4000-8000-000000000103', content: '他随后点燃了蚊香。' },
] as const;

export const MODEL_CONFIGURATIONS = [
  { label: 'GPT-5.6 Luna / none', provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'none' as const },
  { label: 'GPT-5.6 Luna / medium', provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'medium' as const },
  { label: 'DeepSeek Pro / off', provider: 'deepseek', model: 'deepseek-v4-pro', reasoningEffort: 'off' as const },
] as const;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const FORMAL_REPORT_PATH = resolve(REPOSITORY_ROOT, 'docs/reports/2026-08-15-mosquito-question-judge-v5-25case-3config-5round.md');
export const FORMAL_RESULTS_PATH = resolve(REPOSITORY_ROOT, 'docs/reports/2026-08-15-mosquito-question-judge-v5-25case-3config-5round.results.json');
export const HISTORICAL_V4_RESULTS_PATH = resolve(REPOSITORY_ROOT, 'docs/reports/2026-08-15-mosquito-question-judge-v4-25case-3config-5round.results.json');

export type LiveBenchmarkOptions = {
  rounds: number;
  caseIds: string[] | null;
  writeReports: boolean;
  reportPath?: string;
  resultsPath?: string;
};

export type BenchmarkJudge = {
  judgeQuestion(input: QuestionJudgeInput): Promise<QuestionJudgeResult | JudgeResultWithUsage>;
};

export type LiveBenchmarkDependencies = {
  loadFixture?: () => Promise<QuestionJudgeGoldFixture>;
  judgeFactory?: (configuration: (typeof MODEL_CONFIGURATIONS)[number]) => BenchmarkJudge | Promise<BenchmarkJudge>;
  writeFile?: typeof writeFile;
  readFile?: typeof readFile;
  mkdir?: typeof mkdir;
  frozenCommit?: string;
  now?: () => Date;
  log?: (line: string) => void;
};

function usageResult(value: QuestionJudgeResult | JudgeResultWithUsage): JudgeResultWithUsage {
  if (typeof value === 'object' && value !== null && 'result' in value && value.result && typeof value.result === 'object') {
    return value as JudgeResultWithUsage;
  }
  return { result: value as QuestionJudgeResult, inputTokens: null, outputTokens: null, costUsd: null };
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  if (error instanceof Error && error.name) return error.name;
  return 'UNKNOWN_ERROR';
}

function normalizeCoverage(ids: string[]): string[] {
  const labels = new Map<string, string>(FIXED_KEY_POINTS.map(({ id, label }) => [id, label]));
  return ids.map((id) => labels.get(id) ?? id);
}

function buildInput(fixture: QuestionJudgeGoldFixture, testCase: QuestionJudgeGoldCase): QuestionJudgeInput {
  return {
    puzzle_surface: fixture.puzzle_surface,
    full_solution: fixture.full_solution,
    key_points: FIXED_KEY_POINTS.map(({ id, content }) => ({ id, content })),
    current_message: testCase.question,
  };
}

export function parseLiveBenchmarkArgs(argv: string[]): LiveBenchmarkOptions {
  let rounds = 5;
  let caseIds: string[] | null = null;
  let writeReports = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--no-write') {
      writeReports = false;
      continue;
    }
    if (argument === '--rounds') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value <= 0) throw new Error('--rounds must be a positive integer');
      rounds = value;
      continue;
    }
    if (argument === '--cases') {
      const value = argv[++index];
      if (!value) throw new Error('--cases requires a comma-separated list');
      caseIds = value.split(',').map((id) => id.trim()).filter(Boolean);
      if (!caseIds.length) throw new Error('--cases must contain at least one case ID');
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return { rounds, caseIds, writeReports };
}

function defaultJudgeFactory(configuration: (typeof MODEL_CONFIGURATIONS)[number]): BenchmarkJudge {
  const timeoutMs = Number(process.env.JUDGE_TIMEOUT_MS ?? '30000');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('JUDGE_TIMEOUT_MS must be a positive integer');
  if (configuration.provider === 'deepseek') {
    const apiBaseUrl = process.env.JUDGE_API_BASE_URL?.trim();
    const apiKey = process.env.JUDGE_API_KEY?.trim();
    if (!apiBaseUrl || !apiKey) throw new Error('JUDGE_API_BASE_URL and JUDGE_API_KEY are required for DeepSeek benchmarks');
    const invoke = createHarnessInvoker({
      apiBaseUrl,
      apiKey,
      timeoutMs,
      model: configuration.model,
      reasoningEffort: configuration.reasoningEffort,
    });
    return new HarnessSemanticJudge(invoke, timeoutMs);
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI benchmarks');
  return new OpenAIResponsesSemanticJudge({
    apiBaseUrl: process.env.OPENAI_API_BASE_URL?.trim() || 'https://api.openai.com/v1',
    apiKey,
    model: 'gpt-5.6-luna',
    reasoningEffort: configuration.reasoningEffort as OpenAIReasoningEffort,
    timeoutMs,
  });
}

export async function runQuestionJudgeRegression(
  options: LiveBenchmarkOptions,
  dependencies: LiveBenchmarkDependencies = {},
): Promise<{ fixture: QuestionJudgeGoldFixture; attempts: RegressionAttempt[]; reportPath: string; resultsPath: string }> {
  const fixture = await (dependencies.loadFixture ?? loadQuestionJudgeFixture)();
  const frozenCommit = (
    dependencies.frozenCommit !== undefined
      ? dependencies.frozenCommit
      : process.env.BENCHMARK_FROZEN_COMMIT
  )?.trim() ?? '';
  let historicalV4Attempts: RegressionAttempt[] | null = null;
  if (options.writeReports) {
    if (!/^[0-9a-f]{40}$/i.test(frozenCommit)) {
      throw new Error('BENCHMARK_FROZEN_COMMIT must contain the full 40-character commit hash before a report-writing run');
    }
    const read = dependencies.readFile ?? readFile;
    const historical = JSON.parse(await read(HISTORICAL_V4_RESULTS_PATH, 'utf8')) as RegressionResultsDocument;
    if (historical.dataset !== 'mosquito_question_judge_regression_v4' || !Array.isArray(historical.attempts)) {
      throw new Error('historical v4 benchmark results are missing or invalid');
    }
    historicalV4Attempts = historical.attempts;
  }
  const selectedCases = options.caseIds === null
    ? fixture.cases
    : options.caseIds.map((id) => {
      const testCase = fixture.cases.find((candidate) => candidate.id === id);
      if (!testCase) throw new Error(`unknown fixture case: ${id}`);
      return testCase;
    });
  const judgeFactory = dependencies.judgeFactory ?? defaultJudgeFactory;
  const log = dependencies.log ?? console.log;
  const attempts: RegressionAttempt[] = [];
  const now = dependencies.now ?? (() => new Date());

  for (const configuration of MODEL_CONFIGURATIONS) {
    const judge = await judgeFactory(configuration);
    for (let round = 1; round <= options.rounds; round += 1) {
      for (const testCase of selectedCases) {
        const input = buildInput(fixture, testCase);
        const startedAt = performance.now();
        let actual: QuestionJudgeResult | null = null;
        let actualCoverage: string[] = [];
        let inputTokens: number | null = null;
        let outputTokens: number | null = null;
        let costUsd: number | null = null;
        let error: string | null = null;
        let schemaValid = false;
        try {
          const raw = usageResult(await judge.judgeQuestion(input));
          actual = raw.result;
          actualCoverage = normalizeCoverage(raw.result.fully_covered_key_point_ids);
          inputTokens = raw.inputTokens ?? null;
          outputTokens = raw.outputTokens ?? null;
          costUsd = raw.costUsd ?? null;
          schemaValid = true;
        } catch (caught) {
          error = errorCode(caught);
        }
        const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
        const evaluation = evaluateAttempt(actual && {
          verdict: actual.verdict,
          fully_covered_key_point_ids: actualCoverage,
        }, {
          expectedVerdict: testCase.expected_verdict,
          expectedCoverage: testCase.expected_coverage,
        });
        const failureCategories = classifyFailure(actual && {
          verdict: actual.verdict,
          fully_covered_key_point_ids: actualCoverage,
        }, {
          expectedVerdict: testCase.expected_verdict,
          expectedCoverage: testCase.expected_coverage,
          policyTags: testCase.policy_tags,
        }, error);
        const attempt: RegressionAttempt = {
          round,
          configuration: configuration.label,
          provider: configuration.provider,
          model: configuration.model,
          reasoningEffort: configuration.reasoningEffort,
          caseId: testCase.id,
          question: testCase.question,
          policyTags: testCase.policy_tags,
          expectedVerdict: testCase.expected_verdict,
          expectedCoverage: testCase.expected_coverage,
          actualVerdict: evaluation.actualVerdict,
          actualCoverage: evaluation.actualCoverage,
          verdictCorrect: evaluation.verdictCorrect,
          coverageCorrect: evaluation.coverageCorrect,
          schemaValid,
          latencyMs,
          inputTokens,
          outputTokens,
          costUsd,
          errorCode: error,
          failureCategories,
        };
        attempts.push(attempt);
        log(`[${attempts.length}] ${configuration.label} round=${round} case=${testCase.id} valid=${schemaValid ? 'yes' : 'no'} latency=${latencyMs}ms${error ? ` error=${error}` : ''}`);
      }
    }
  }

  const expectedCount = selectedCases.length * MODEL_CONFIGURATIONS.length * options.rounds;
  if (attempts.length !== expectedCount) throw new Error(`benchmark produced ${attempts.length} attempts; expected ${expectedCount}`);

  const generatedAt = now().toISOString();
  const metadata = {
    generatedAt,
    promptVersion: QUESTION_JUDGE_PROMPT_VERSION,
    schemaVersion: 'judge-schema-v1',
    rounds: options.rounds,
    configurations: MODEL_CONFIGURATIONS.map(({ label, provider, model, reasoningEffort }) => ({ label, provider, model, reasoningEffort })),
    fixturePath: 'services/judge-worker/benchmarks/fixtures/mosquito-question-judge-v5-25cases.json',
    frozenCommit: frozenCommit || null,
  };
  const reportPath = options.reportPath ?? FORMAL_REPORT_PATH;
  const resultsPath = options.resultsPath ?? FORMAL_RESULTS_PATH;
  if (options.writeReports) {
    const write = dependencies.writeFile ?? writeFile;
    const makeDirectory = dependencies.mkdir ?? mkdir;
    await makeDirectory(dirname(reportPath), { recursive: true });
    await makeDirectory(dirname(resultsPath), { recursive: true });
    const baseReport = renderRegressionReport(fixture, attempts, metadata).trimEnd();
    const versionComparison = renderVersionComparison(historicalV4Attempts ?? [], attempts, fixture).trimEnd();
    await write(reportPath, `${baseReport}\n\n${versionComparison}\n`, 'utf8');
    await write(resultsPath, serializeRegressionResults(attempts, metadata), 'utf8');
  }

  const aggregate = summarizeAttempts(attempts);
  log('comparison: configuration | verdict accuracy | KP coverage accuracy | avg latency | failures');
  for (const configuration of MODEL_CONFIGURATIONS) {
    const summary = aggregate.byConfiguration[configuration.label];
    if (!summary) continue;
    const failures = Object.entries(summary.failures).filter(([, count]) => count > 0).map(([category, count]) => `${category}=${count}`).join(',') || 'none';
    log(`${configuration.label} | ${(summary.verdictAccuracy * 100).toFixed(1)}% | ${(summary.coverageAccuracy * 100).toFixed(1)}% | ${summary.averageLatencyMs === null ? 'N/A' : `${summary.averageLatencyMs.toFixed(1)}ms`} | ${failures}`);
  }
  const failedRows = attempts.filter(({ verdictCorrect, coverageCorrect, schemaValid }) => !(verdictCorrect && coverageCorrect && schemaValid));
  log('comparison: failed rows | configuration | round | case | expected verdict/coverage | actual verdict/coverage | categories');
  for (const attempt of failedRows) {
    log(`${attempt.configuration} | ${attempt.round} | ${attempt.caseId} | ${attempt.expectedVerdict}/${attempt.expectedCoverage.join(',') || '-'} | ${attempt.actualVerdict ?? 'ERROR'}/${attempt.actualCoverage.join(',') || '-'} | ${attempt.failureCategories.join(',') || attempt.errorCode || 'unknown'}`);
  }
  log(`comparison: attempts=${attempts.length}`);
  return { fixture, attempts, reportPath, resultsPath };
}

async function main(): Promise<void> {
  const options = parseLiveBenchmarkArgs(process.argv.slice(2));
  await runQuestionJudgeRegression(options);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error) => {
    const code = error instanceof SemanticJudgeRuntimeError ? error.code : 'BENCHMARK_ERROR';
    console.error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export const BENCHMARK_MODULE_PATH = fileURLToPath(import.meta.url);
