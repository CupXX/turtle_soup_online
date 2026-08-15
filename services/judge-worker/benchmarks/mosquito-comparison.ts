import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { JudgeVerdict, QuestionJudgeResult } from '@turtle-soup/contracts';
import { HarnessSemanticJudge } from '../src/runtime/harness-semantic-judge.js';
import { createHarnessInvoker } from '../src/runtime/create-harness-invoker.js';
import { validateKeyPointExtractionResult } from '../src/skills/validate-result.js';

export type ExpectedCase = {
  id: string;
  content: string;
  verdict: JudgeVerdict;
  covered: number[];
};

export type ComparisonRow = {
  questionId: string;
  question: string;
  expectedVerdict: JudgeVerdict;
  expectedCoveredIds: string[];
  configuration: string;
  actualVerdict: JudgeVerdict | null;
  actualCoveredIds: string[];
  verdictCorrect: boolean;
  coverageCorrect: boolean;
  schemaValid: boolean;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  errorCode?: string | null;
};

export type ComparisonSummary = { verdict: string; coverage: string };

export type ComparisonReportInput = {
  extractedKeyPoints: string[];
  rows: ComparisonRow[];
  apiKey?: string;
  generatedAt?: string;
};

type MosquitoFixture = {
  version: string;
  puzzle_surface: string;
  full_solution: string;
  expected_key_points: string[];
  questions: ExpectedCase[];
};

type ModelConfiguration = {
  label: string;
  model: string;
  reasoningEffort: 'off' | 'high';
};

export const KEY_POINT_IDS = [
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
] as const;

export const MODEL_CONFIGURATIONS: readonly ModelConfiguration[] = [
  { label: 'Flash', model: 'deepseek-v4-flash', reasoningEffort: 'off' },
  { label: 'Pro', model: 'deepseek-v4-pro', reasoningEffort: 'off' },
  { label: 'Pro + thinking', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
];

const benchmarkRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function evaluateCase(
  actual: Pick<QuestionJudgeResult, 'verdict' | 'fully_covered_key_point_ids'>,
  expected: { verdict: JudgeVerdict; coveredIds: readonly string[] },
): { verdictCorrect: boolean; coverageCorrect: boolean } {
  return {
    verdictCorrect: actual.verdict === expected.verdict,
    coverageCorrect: sameSet(actual.fully_covered_key_point_ids, expected.coveredIds),
  };
}

export function summarize(results: Array<Pick<ComparisonRow, 'verdictCorrect' | 'coverageCorrect'>>): ComparisonSummary {
  const verdictCorrect = results.filter((result) => result.verdictCorrect).length;
  const coverageCorrect = results.filter((result) => result.coverageCorrect).length;
  return {
    verdict: `${verdictCorrect}/${results.length}`,
    coverage: `${coverageCorrect}/${results.length}`,
  };
}

function formatIds(ids: readonly string[]): string {
  return ids.length === 0 ? '—' : ids.map((id) => {
    const ordinal = KEY_POINT_IDS.indexOf(id as typeof KEY_POINT_IDS[number]);
    return ordinal >= 0 ? `KP${ordinal + 1}` : id;
  }).join(', ');
}

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return String(value);
}

function summaryRows(rows: ComparisonRow[]): string {
  return MODEL_CONFIGURATIONS.map((configuration) => {
    const results = rows.filter((row) => row.configuration === configuration.label);
    const summary = summarize(results);
    const schemaValid = results.filter((row) => row.schemaValid).length;
    const latencies = results.flatMap((row) => row.latencyMs === null ? [] : [row.latencyMs]);
    const averageLatency = latencies.length === 0
      ? 'N/A'
      : `${Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length)} ms`;
    return `| ${configuration.label} | ${summary.verdict} | ${summary.coverage} | ${schemaValid}/${results.length} | ${averageLatency} |`;
  }).join('\n');
}

export function renderComparisonReport(input: ComparisonReportInput): string {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const tableRows = input.rows.map((row) => [
    `| ${row.questionId} | ${row.question} | ${row.expectedVerdict} | ${formatIds(row.expectedCoveredIds)} | ${row.configuration} | ${formatValue(row.actualVerdict)} | ${formatIds(row.actualCoveredIds)} | ${row.verdictCorrect ? '✅' : '❌'} | ${row.coverageCorrect ? '✅' : '❌'} | ${row.schemaValid ? '✅' : '❌'} | ${formatValue(row.latencyMs === null ? null : `${row.latencyMs} ms`)} | ${formatValue(row.inputTokens)} / ${formatValue(row.outputTokens)} | ${formatValue(row.costUsd)} | ${formatValue(row.errorCode)} |`,
  ].join('')).join('\n');

  const report = `# 蚊子汤模型控制实验报告

生成时间：${generatedAt}

## A. 最终提取的关键点

${input.extractedKeyPoints.map((point, index) => `${index + 1}. ${point}`).join('\n')}

## B. Question Judge 逐题比较

| Case | Question | Expected verdict | Expected coverage | Configuration | Actual verdict | Actual coverage | Verdict correct | Coverage correct | Schema valid | Latency | Tokens (input / output) | Cost (USD) | Error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${tableRows}

## C. 准确率摘要

| Configuration | Verdict accuracy | KP coverage accuracy | Schema validity | Average latency |
| --- | --- | --- | --- | --- |
${summaryRows(input.rows)}

Verdict accuracy and key-point coverage accuracy are intentionally reported separately. A YES/NO/BOTH/IRRELEVANT verdict does not by itself imply that any key point was fully covered.

## D. 延迟与用量

Latency is measured end to end for each model call. The current headless Harness stdout contract does not expose provider token usage or cost, so those fields are reported as N/A rather than estimated.

## E. Interpretation

The controlled fixture uses one production prompt, one fixed key-point set, and identical eight semantic inputs for all configurations. If the same case fails across all three configurations, treat it as a remaining prompt/policy problem first. Differences isolated to one model or reasoning setting are evidence of capability/configuration sensitivity, not proof that the original failure was model incapability.

## F. Next experiment recommendation

Keep the current v2 semantic policy and repeat this fixture after any prompt change. If verdict accuracy is stable but coverage differs, tune only the complete-fact coverage policy. If the three configurations remain separated after a second run, use Pro + thinking for extraction and compare Flash versus Pro for question judging on a larger fixed suite before selecting a permanent production route.
`;

  return input.apiKey && input.apiKey.length > 0 ? report.replaceAll(input.apiKey, '[REDACTED]') : report;
}

async function readFixture(): Promise<MosquitoFixture> {
  const content = await readFile(resolve(benchmarkRoot, 'fixtures/mosquito-controlled.json'), 'utf8');
  return JSON.parse(content) as MosquitoFixture;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for benchmark`);
  return value;
}

function timeoutFromEnv(): number {
  const value = Number(process.env.JUDGE_TIMEOUT_MS ?? '30000');
  if (!Number.isInteger(value) || value <= 0) throw new Error('JUDGE_TIMEOUT_MS must be a positive integer');
  return value;
}

function makeJudge(model: string, reasoningEffort: 'off' | 'high', timeoutMs: number): HarnessSemanticJudge {
  return new HarnessSemanticJudge(createHarnessInvoker({
    apiBaseUrl: requiredEnv('JUDGE_API_BASE_URL'),
    apiKey: requiredEnv('JUDGE_API_KEY'),
    timeoutMs,
    model,
    reasoningEffort,
  }), timeoutMs);
}

async function runLiveComparison(): Promise<{ report: string; reportPath: string }> {
  const fixture = await readFixture();
  if (fixture.questions.length !== 8) throw new Error(`controlled fixture must contain 8 questions, got ${fixture.questions.length}`);
  const timeoutMs = timeoutFromEnv();
  const extractionJudge = makeJudge('deepseek-v4-pro', 'high', timeoutMs);
  const extractionStarted = performance.now();
  const extraction = validateKeyPointExtractionResult(await extractionJudge.extractKeyPoints({
    puzzle_surface: fixture.puzzle_surface,
    full_solution: fixture.full_solution,
  }));
  const extractionLatency = Math.round(performance.now() - extractionStarted);
  if (extraction.key_points.length !== KEY_POINT_IDS.length) {
    throw new Error(`controlled extraction must return exactly 3 key points; got ${extraction.key_points.length} in ${extractionLatency} ms`);
  }
  const keyPoints = extraction.key_points.map((point, index) => ({ id: KEY_POINT_IDS[index], content: point.content }));

  const rows: ComparisonRow[] = [];
  for (const configuration of MODEL_CONFIGURATIONS) {
    const judge = makeJudge(configuration.model, configuration.reasoningEffort, timeoutMs);
    for (const question of fixture.questions) {
      const expectedCoveredIds = question.covered.map((ordinal) => KEY_POINT_IDS[ordinal - 1]).filter(Boolean);
      const startedAt = performance.now();
      try {
        const actual = await judge.judgeQuestion({
          puzzle_surface: fixture.puzzle_surface,
          full_solution: fixture.full_solution,
          key_points: keyPoints,
          current_message: question.content,
        });
        const correctness = evaluateCase(actual, { verdict: question.verdict, coveredIds: expectedCoveredIds });
        rows.push({
          questionId: question.id,
          question: question.content,
          expectedVerdict: question.verdict,
          expectedCoveredIds,
          configuration: configuration.label,
          actualVerdict: actual.verdict,
          actualCoveredIds: actual.fully_covered_key_point_ids,
          ...correctness,
          schemaValid: true,
          latencyMs: Math.round(performance.now() - startedAt),
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
        });
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'UNKNOWN_ERROR';
        rows.push({
          questionId: question.id,
          question: question.content,
          expectedVerdict: question.verdict,
          expectedCoveredIds,
          configuration: configuration.label,
          actualVerdict: null,
          actualCoveredIds: [],
          verdictCorrect: false,
          coverageCorrect: false,
          schemaValid: false,
          latencyMs: Math.round(performance.now() - startedAt),
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          errorCode: code,
        });
      }
    }
  }

  if (rows.length !== fixture.questions.length * MODEL_CONFIGURATIONS.length) {
    throw new Error(`comparison must contain 24 rows; got ${rows.length}`);
  }
  const report = renderComparisonReport({
    extractedKeyPoints: extraction.key_points.map((point) => point.content),
    rows,
    apiKey: process.env.JUDGE_API_KEY,
  });
  const reportPath = resolve(projectRoot, 'docs/reports/2026-08-15-mosquito-model-comparison.md');
  await mkdir(resolve(projectRoot, 'docs/reports'), { recursive: true });
  await writeFile(reportPath, report, 'utf8');
  return { report, reportPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runLiveComparison();
  process.stdout.write(`${result.report}\nReport written to ${result.reportPath}\n`);
}
