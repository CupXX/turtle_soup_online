import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { JudgeVerdict, QuestionJudgeInput, QuestionJudgeResult } from '@turtle-soup/contracts';
import { OpenAIResponsesSemanticJudge, type OpenAIReasoningEffort } from './openai-responses-semantic-judge.js';
import type { JudgeResultWithUsage, RegressionAttempt } from './question-judge-regression.js';
import {
  classifyFailure,
  evaluateAttempt,
  summarizeAttempts,
  type FailureCategory,
} from './question-judge-regression.js';
import {
  ALL_CHOICES_CORRECT_DATASET,
  ALL_CHOICES_FIXED_KEY_POINTS,
  type AllChoicesCorrectCase,
  type AllChoicesCorrectFixture,
  loadAllChoicesCorrectFixture,
} from './all-choices-correct-question-judge-regression.js';
import { QUESTION_JUDGE_PROMPT_VERSION } from '../src/skills/question-judge.js';
import { SemanticJudgeRuntimeError } from '../src/runtime/semantic-judge.js';

export const ALL_CHOICES_MODEL_CONFIGURATIONS = [
  { label: 'GPT-5.6 Luna / none', provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'none' as const },
  { label: 'GPT-5.6 Luna / medium', provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'medium' as const },
] as const;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const ALL_CHOICES_FORMAL_REPORT_PATH = resolve(REPOSITORY_ROOT, 'docs/reports/2026-08-16-all-choices-correct-question-judge-v6-30case-2config-5round.md');
export const ALL_CHOICES_FORMAL_RESULTS_PATH = resolve(REPOSITORY_ROOT, 'docs/reports/2026-08-16-all-choices-correct-question-judge-v6-30case-2config-5round.results.json');

export type AllChoicesBenchmarkOptions = {
  rounds: number;
  caseIds: string[] | null;
  writeReports: boolean;
  reportPath?: string;
  resultsPath?: string;
};

export type AllChoicesBenchmarkJudge = {
  judgeQuestion(input: QuestionJudgeInput): Promise<QuestionJudgeResult | JudgeResultWithUsage>;
};

export type AllChoicesBenchmarkDependencies = {
  loadFixture?: () => Promise<AllChoicesCorrectFixture>;
  judgeFactory?: (configuration: (typeof ALL_CHOICES_MODEL_CONFIGURATIONS)[number]) => AllChoicesBenchmarkJudge | Promise<AllChoicesBenchmarkJudge>;
  writeFile?: typeof writeFile;
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
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  if (error instanceof Error && error.name) return error.name;
  return 'UNKNOWN_ERROR';
}

function normalizeCoverage(ids: string[]): string[] {
  const labels = new Map<string, string>(ALL_CHOICES_FIXED_KEY_POINTS.map(({ id, label }) => [id, label]));
  return ids.map((id) => labels.get(id) ?? id);
}

function buildInput(fixture: AllChoicesCorrectFixture, testCase: AllChoicesCorrectCase): QuestionJudgeInput {
  return {
    puzzle_surface: fixture.puzzle_surface,
    full_solution: fixture.full_solution,
    key_points: ALL_CHOICES_FIXED_KEY_POINTS.map(({ id, content }) => ({ id, content })),
    current_message: testCase.question,
  };
}

export function parseAllChoicesBenchmarkArgs(argv: string[]): AllChoicesBenchmarkOptions {
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

function defaultJudgeFactory(configuration: (typeof ALL_CHOICES_MODEL_CONFIGURATIONS)[number]): AllChoicesBenchmarkJudge {
  const timeoutMs = Number(process.env.JUDGE_TIMEOUT_MS ?? '30000');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('JUDGE_TIMEOUT_MS must be a positive integer');
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for Luna benchmarks');
  return new OpenAIResponsesSemanticJudge({
    apiBaseUrl: process.env.OPENAI_API_BASE_URL?.trim() || 'https://api.openai.com/v1',
    apiKey,
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort as OpenAIReasoningEffort,
    timeoutMs,
  });
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(1);
}

function formatFailures(failures: Record<FailureCategory, number>): string {
  return Object.entries(failures).filter(([, count]) => count > 0).map(([category, count]) => `${category}=${count}`).join(', ') || 'none';
}

export function renderAllChoicesReport(
  fixture: AllChoicesCorrectFixture,
  attempts: RegressionAttempt[],
  metadata: {
    generatedAt: string;
    promptVersion: string;
    schemaVersion: string;
    rounds: number;
    configurations: Array<{ label: string; provider: string; model: string; reasoningEffort: string }>;
    fixturePath: string;
    frozenCommit: string;
  },
): string {
  const aggregate = summarizeAttempts(attempts);
  const lines: string[] = [
    `# All Choices Correct Question Judge v6 — 30-case, ${metadata.configurations.length}-configuration, ${metadata.rounds}-round comparison`,
    '',
    `- Generated: ${metadata.generatedAt}`,
    `- Fixture: ${metadata.fixturePath}`,
    `- Prompt: ${metadata.promptVersion}`,
    `- Schema: ${metadata.schemaVersion}`,
    `- Rounds: ${metadata.rounds}`,
    `- Attempts: ${attempts.length}`,
    `- Frozen commit: ${metadata.frozenCommit}`,
    '',
    '## Fixed key points',
    '',
    ...fixture.key_points.map(({ id, content }) => `- ${id}: ${content}`),
    '',
    '## Configuration comparison',
    '',
    '| Configuration | Attempts | Valid | Verdict accuracy | KP coverage accuracy | Strict joint accuracy | Valid verdict accuracy | Valid KP coverage accuracy | Avg ms | P50 ms | P95 ms | Input tokens | Output tokens | Cost USD | Failures |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const configuration of metadata.configurations) {
    const summary = aggregate.byConfiguration[configuration.label];
    if (!summary) continue;
    lines.push(`| ${configuration.label} | ${summary.total} | ${summary.validResults} | ${formatPercent(summary.verdictAccuracy)} | ${formatPercent(summary.coverageAccuracy)} | ${formatPercent(summary.jointAccuracy)} | ${summary.validVerdictAccuracy === null ? 'N/A' : formatPercent(summary.validVerdictAccuracy)} | ${summary.validCoverageAccuracy === null ? 'N/A' : formatPercent(summary.validCoverageAccuracy)} | ${formatNumber(summary.averageLatencyMs)} | ${formatNumber(summary.p50LatencyMs)} | ${formatNumber(summary.p95LatencyMs)} | ${summary.inputTokens ?? 'N/A'} | ${summary.outputTokens ?? 'N/A'} | ${summary.costUsd === null ? 'N/A' : summary.costUsd.toFixed(6)} | ${formatFailures(summary.failures)} |`);
  }
  lines.push(
    '',
    '## Overall',
    '',
    `- Verdict accuracy: ${formatPercent(aggregate.overall.verdictAccuracy)} (${aggregate.overall.verdictCorrect}/${aggregate.overall.total})`,
    `- Key-point coverage accuracy: ${formatPercent(aggregate.overall.coverageAccuracy)} (${aggregate.overall.coverageCorrect}/${aggregate.overall.total})`,
    `- Strict joint accuracy: ${formatPercent(aggregate.overall.jointAccuracy)} (${aggregate.overall.jointCorrect}/${aggregate.overall.total})`,
    `- Valid result rate: ${formatPercent(aggregate.overall.total ? aggregate.overall.validResults / aggregate.overall.total : 0)}`,
    `- Latency: average ${formatNumber(aggregate.overall.averageLatencyMs)} ms, P50 ${formatNumber(aggregate.overall.p50LatencyMs)} ms, P95 ${formatNumber(aggregate.overall.p95LatencyMs)} ms`,
    `- Token/cost fields are authoritative provider values only; absent values remain N/A.`,
    '',
    '## Actual verdict distribution',
    '',
    '| Configuration | YES | NO | BOTH | IRRELEVANT | Invalid |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const configuration of metadata.configurations) {
    const group = attempts.filter(({ configuration: label }) => label === configuration.label);
    const count = (verdict: JudgeVerdict) => group.filter(({ schemaValid, actualVerdict }) => schemaValid && actualVerdict === verdict).length;
    lines.push(`| ${configuration.label} | ${count('YES')} | ${count('NO')} | ${count('BOTH')} | ${count('IRRELEVANT')} | ${group.filter(({ schemaValid }) => !schemaValid).length} |`);
  }
  lines.push('', '## Per-case stability', '', '| Case | Expected verdict | Expected KP | Verdict accuracy | KP coverage accuracy | Strict joint accuracy | Failures |', '| --- | --- | --- | ---: | ---: | ---: | --- |');
  for (const testCase of fixture.cases) {
    const summary = aggregate.byCase[testCase.id];
    if (!summary) continue;
    lines.push(`| ${testCase.id} | ${testCase.expectedVerdict} | ${testCase.expectedCoverage.join(', ') || '—'} | ${formatPercent(summary.verdictAccuracy)} | ${formatPercent(summary.coverageAccuracy)} | ${formatPercent(summary.jointAccuracy)} | ${formatFailures(summary.failures)} |`);
  }
  lines.push(
    '',
    '## Interpretation',
    '',
    '- Verdict correctness and key-point coverage are measured independently. A correct YES with no KP and a BOTH result with coverage from its true proposition are valid outcomes by design.',
    '- Surface-framing misses are reported separately from generic semantic misses; KP over/under-trigger and multi-KP errors remain separate from verdict errors.',
    '- Consistent errors across both reasoning settings suggest a policy/gold issue; errors concentrated in Luna none or varying by round are model-capability/stability observations.',
    '- This is a controlled single-puzzle capability comparison. It does not by itself authorize permanent model routing changes.',
    '',
  );
  return `${lines.join('\n').trimEnd()}\n`;
}

export function serializeAllChoicesResults(
  attempts: RegressionAttempt[],
  metadata: { generatedAt: string; promptVersion: string; schemaVersion: string; rounds: number; configurations: Array<{ label: string; provider: string; model: string; reasoningEffort: string }>; fixturePath: string; frozenCommit: string },
): string {
  return `${JSON.stringify({
    dataset: ALL_CHOICES_CORRECT_DATASET,
    generatedAt: metadata.generatedAt,
    promptVersion: metadata.promptVersion,
    schemaVersion: metadata.schemaVersion,
    rounds: metadata.rounds,
    configurations: metadata.configurations,
    fixturePath: metadata.fixturePath,
    frozenCommit: metadata.frozenCommit,
    attempts,
  }, null, 2)}\n`;
}

export async function runAllChoicesQuestionJudgeRegression(
  options: AllChoicesBenchmarkOptions,
  dependencies: AllChoicesBenchmarkDependencies = {},
): Promise<{ fixture: AllChoicesCorrectFixture; attempts: RegressionAttempt[]; reportPath: string; resultsPath: string }> {
  const fixture = await (dependencies.loadFixture ?? loadAllChoicesCorrectFixture)();
  const frozenCommit = (dependencies.frozenCommit ?? process.env.BENCHMARK_FROZEN_COMMIT)?.trim() ?? '';
  if (options.writeReports && !/^[0-9a-f]{40}$/i.test(frozenCommit)) throw new Error('BENCHMARK_FROZEN_COMMIT must contain the full 40-character commit hash before a report-writing run');
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
  for (const configuration of ALL_CHOICES_MODEL_CONFIGURATIONS) {
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
          actual = { verdict: raw.result.verdict, fully_covered_key_point_ids: normalizeCoverage(raw.result.fully_covered_key_point_ids) };
          actualCoverage = actual.fully_covered_key_point_ids;
          inputTokens = raw.inputTokens ?? null;
          outputTokens = raw.outputTokens ?? null;
          costUsd = raw.costUsd ?? null;
          schemaValid = true;
        } catch (caught) {
          error = errorCode(caught);
        }
        const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
        const evaluation = evaluateAttempt(actual, { expectedVerdict: testCase.expectedVerdict, expectedCoverage: testCase.expectedCoverage });
        const failureCategories = classifyFailure(actual, { expectedVerdict: testCase.expectedVerdict, expectedCoverage: testCase.expectedCoverage, policyTags: testCase.policyTags }, error);
        attempts.push({
          round,
          configuration: configuration.label,
          provider: configuration.provider,
          model: configuration.model,
          reasoningEffort: configuration.reasoningEffort,
          caseId: testCase.id,
          question: testCase.question,
          policyTags: testCase.policyTags,
          expectedVerdict: testCase.expectedVerdict,
          expectedCoverage: testCase.expectedCoverage,
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
        });
        log(`[${attempts.length}] ${configuration.label} round=${round} case=${testCase.id} valid=${schemaValid ? 'yes' : 'no'} latency=${latencyMs}ms${error ? ` error=${error}` : ''}`);
      }
    }
  }
  const expectedCount = selectedCases.length * ALL_CHOICES_MODEL_CONFIGURATIONS.length * options.rounds;
  if (attempts.length !== expectedCount) throw new Error(`benchmark produced ${attempts.length} attempts; expected ${expectedCount}`);
  const generatedAt = now().toISOString();
  const metadata = {
    generatedAt,
    promptVersion: QUESTION_JUDGE_PROMPT_VERSION,
    schemaVersion: 'judge-schema-v1',
    rounds: options.rounds,
    configurations: ALL_CHOICES_MODEL_CONFIGURATIONS.map(({ label, provider, model, reasoningEffort }) => ({ label, provider, model, reasoningEffort })),
    fixturePath: 'services/judge-worker/benchmarks/fixtures/all-choices-correct-question-judge-v1-30cases.json',
    frozenCommit: frozenCommit || null,
  };
  const reportPath = options.reportPath ?? ALL_CHOICES_FORMAL_REPORT_PATH;
  const resultsPath = options.resultsPath ?? ALL_CHOICES_FORMAL_RESULTS_PATH;
  if (options.writeReports) {
    const write = dependencies.writeFile ?? writeFile;
    const makeDirectory = dependencies.mkdir ?? mkdir;
    await makeDirectory(dirname(reportPath), { recursive: true });
    await makeDirectory(dirname(resultsPath), { recursive: true });
    await write(reportPath, renderAllChoicesReport(fixture, attempts, { ...metadata, frozenCommit }), 'utf8');
    await write(resultsPath, serializeAllChoicesResults(attempts, { ...metadata, frozenCommit }), 'utf8');
  }
  const aggregate = summarizeAttempts(attempts);
  log('comparison: configuration | verdict accuracy | KP coverage accuracy | strict joint | valid rate | avg latency');
  for (const configuration of ALL_CHOICES_MODEL_CONFIGURATIONS) {
    const summary = aggregate.byConfiguration[configuration.label];
    if (!summary) continue;
    log(`${configuration.label} | ${(summary.verdictAccuracy * 100).toFixed(1)}% | ${(summary.coverageAccuracy * 100).toFixed(1)}% | ${(summary.jointAccuracy * 100).toFixed(1)}% | ${((summary.validResults / summary.total) * 100).toFixed(1)}% | ${summary.averageLatencyMs?.toFixed(1) ?? 'N/A'}ms`);
  }
  return { fixture, attempts, reportPath, resultsPath };
}

async function main(): Promise<void> {
  await runAllChoicesQuestionJudgeRegression(parseAllChoicesBenchmarkArgs(process.argv.slice(2)));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error) => {
    const code = error instanceof SemanticJudgeRuntimeError ? error.code : 'BENCHMARK_ERROR';
    console.error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export const ALL_CHOICES_BENCHMARK_MODULE_PATH = fileURLToPath(import.meta.url);
