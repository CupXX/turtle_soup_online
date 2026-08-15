import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { JudgeVerdict, QuestionJudgeResult } from '@turtle-soup/contracts';

export const QUESTION_JUDGE_VERDICTS = ['YES', 'NO', 'BOTH', 'IRRELEVANT'] as const satisfies readonly JudgeVerdict[];
export const CANONICAL_PUZZLE_SURFACE = '一个人半夜醒来打了自己一巴掌，然后闻着一股燃烧的味道安心睡去了，请问发生了什么？';
export const CANONICAL_FULL_SOLUTION = '这个人被蚊子叮醒，打了一下没打着，然后点起了蚊香。';
export const CANONICAL_KEY_POINTS = [
  { id: 'KP1', text: '他半夜醒来是因为被蚊子叮醒。' },
  { id: 'KP2', text: '他打自己一巴掌是为了拍蚊子，但没有打着。' },
  { id: 'KP3', text: '他随后点燃了蚊香。' },
] as const;

export type QuestionJudgeGoldCase = {
  id: string;
  question: string;
  expected_verdict: JudgeVerdict;
  expected_coverage: string[];
  policy_tags: string[];
  gold_rationale: string;
};

export type QuestionJudgeGoldFixture = {
  dataset_name: string;
  purpose: string;
  puzzle_id: string;
  puzzle_surface: string;
  full_solution: string;
  verdict_enum: JudgeVerdict[];
  key_points: Array<{ id: string; text: string }>;
  policy_summary: Record<string, string>;
  cases: QuestionJudgeGoldCase[];
};

const DEFAULT_FIXTURE_URL = new URL('./fixtures/mosquito-question-judge-v4-25cases.json', import.meta.url);
const DISPUTED_CASES: Record<string, { verdict: JudgeVerdict; coverage: readonly string[] }> = {
  'burning-is-coil': { verdict: 'YES', coverage: ['KP3'] },
  'smell-from-coil': { verdict: 'YES', coverage: [] },
  'intentional-self-hit-ambiguous': { verdict: 'BOTH', coverage: [] },
  'violent-behavior-ambiguous': { verdict: 'BOTH', coverage: [] },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`invalid Question Judge fixture: ${message}`);
}

export function validateQuestionJudgeFixture(value: unknown): QuestionJudgeGoldFixture {
  if (!isRecord(value)) fail('fixture must be an object');
  if (value.puzzle_surface !== CANONICAL_PUZZLE_SURFACE) fail('puzzle_surface differs from the canonical surface');
  if (value.full_solution !== CANONICAL_FULL_SOLUTION) fail('full_solution differs from the canonical solution');
  if (!Array.isArray(value.verdict_enum) || value.verdict_enum.join('|') !== QUESTION_JUDGE_VERDICTS.join('|')) {
    fail('verdict_enum must be YES, NO, BOTH, IRRELEVANT in order');
  }
  if (!Array.isArray(value.key_points) || JSON.stringify(value.key_points) !== JSON.stringify(CANONICAL_KEY_POINTS)) {
    fail('key_points differ from the three canonical key points');
  }
  if (!Array.isArray(value.cases) || value.cases.length !== 25) fail('case count must be 25');

  const seen = new Set<string>();
  for (const [index, rawCase] of value.cases.entries()) {
    if (!isRecord(rawCase)) fail(`case ${index + 1} must be an object`);
    const id = rawCase.id;
    if (typeof id !== 'string' || !id) fail(`case ${index + 1} has no id`);
    if (seen.has(id)) fail(`duplicate case id: ${id}`);
    seen.add(id);
    if (!QUESTION_JUDGE_VERDICTS.includes(rawCase.expected_verdict as JudgeVerdict)) {
      fail(`${id} has an invalid expected_verdict`);
    }
    if (!Array.isArray(rawCase.expected_coverage) || rawCase.expected_coverage.some((coverage) => !['KP1', 'KP2', 'KP3'].includes(coverage))) {
      fail(`${id} has an invalid expected_coverage`);
    }
    const disputed = DISPUTED_CASES[id];
    if (disputed && (rawCase.expected_verdict !== disputed.verdict || JSON.stringify(rawCase.expected_coverage) !== JSON.stringify(disputed.coverage))) {
      fail(`${id} does not match its approved disputed-case expectation`);
    }
  }

  return value as unknown as QuestionJudgeGoldFixture;
}

export async function loadQuestionJudgeFixture(path = fileURLToPath(DEFAULT_FIXTURE_URL)): Promise<QuestionJudgeGoldFixture> {
  const raw = await readFile(path, 'utf8');
  return validateQuestionJudgeFixture(JSON.parse(raw) as unknown);
}

export type RegressionAttempt = {
  round: number;
  configuration: string;
  provider: string;
  model: string;
  reasoningEffort: string;
  caseId: string;
  question: string;
  policyTags: string[];
  expectedVerdict: JudgeVerdict;
  expectedCoverage: string[];
  actualVerdict: JudgeVerdict | null;
  actualCoverage: string[];
  verdictCorrect: boolean;
  coverageCorrect: boolean;
  schemaValid: boolean;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  errorCode: string | null;
  failureCategories: FailureCategory[];
};

export type FailureCategory =
  | 'UNKNOWN_VS_FALSE_FAILURE'
  | 'RELEVANCE_QUESTION_FAILURE'
  | 'SEMANTIC_ENTAILMENT_FAILURE'
  | 'BOTH_MIXED_PROPOSITION_FAILURE'
  | 'BOTH_AMBIGUITY_FAILURE'
  | 'BOTH_OVER_TRIGGER'
  | 'KP_OVER_TRIGGER'
  | 'KP_UNDER_TRIGGER'
  | 'KP_WRONG_ID'
  | 'MULTI_KP_FAILURE'
  | 'SCHEMA_FAILURE'
  | 'TRANSPORT_FAILURE';

export type JudgeResultWithUsage = {
  result: QuestionJudgeResult;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
};

export function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function evaluateAttempt(
  actual: QuestionJudgeResult | null,
  expected: Pick<RegressionAttempt, 'expectedVerdict' | 'expectedCoverage'>,
): Pick<RegressionAttempt, 'actualVerdict' | 'actualCoverage' | 'verdictCorrect' | 'coverageCorrect'> {
  const actualCoverage = actual?.fully_covered_key_point_ids ?? [];
  return {
    actualVerdict: actual?.verdict ?? null,
    actualCoverage,
    verdictCorrect: actual?.verdict === expected.expectedVerdict,
    coverageCorrect: actual !== null && sameSet(actualCoverage, expected.expectedCoverage),
  };
}

export function classifyFailure(
  actual: QuestionJudgeResult | null,
  expected: Pick<RegressionAttempt, 'expectedVerdict' | 'expectedCoverage' | 'policyTags'>,
  errorCode: string | null = null,
): FailureCategory[] {
  const categories: FailureCategory[] = [];

  if (!actual) {
    if (errorCode === 'INVALID_JSON' || errorCode === 'SCHEMA_INVALID' || errorCode === 'UNKNOWN_KEY_POINT_ID') {
      return ['SCHEMA_FAILURE'];
    }
    return ['TRANSPORT_FAILURE'];
  }

  if (actual.verdict !== expected.expectedVerdict) {
    if (actual.verdict === 'BOTH' && expected.expectedVerdict !== 'BOTH') {
      categories.push('BOTH_OVER_TRIGGER');
    } else if (expected.expectedVerdict === 'BOTH') {
      if (expected.policyTags.includes('mixed_true_false')) categories.push('BOTH_MIXED_PROPOSITION_FAILURE');
      if (expected.policyTags.includes('material_ambiguity')) categories.push('BOTH_AMBIGUITY_FAILURE');
      if (!categories.length) categories.push('SEMANTIC_ENTAILMENT_FAILURE');
    } else if (expected.expectedVerdict === 'IRRELEVANT' && expected.policyTags.includes('relevance_question_override')) {
      categories.push('RELEVANCE_QUESTION_FAILURE');
    } else if (expected.expectedVerdict === 'IRRELEVANT') {
      categories.push('UNKNOWN_VS_FALSE_FAILURE');
    } else {
      categories.push('SEMANTIC_ENTAILMENT_FAILURE');
    }
  }

  if (!sameSet(actual.fully_covered_key_point_ids, expected.expectedCoverage)) {
    const actualHas = actual.fully_covered_key_point_ids.length > 0;
    const expectedHas = expected.expectedCoverage.length > 0;
    if (!expectedHas && actualHas) categories.push('KP_OVER_TRIGGER');
    else if (expectedHas && !actualHas) categories.push('KP_UNDER_TRIGGER');
    else if (actual.fully_covered_key_point_ids.length > 1 || expected.expectedCoverage.length > 1) {
      categories.push('MULTI_KP_FAILURE');
    } else {
      categories.push('KP_WRONG_ID');
    }
  }

  return categories;
}

export type AttemptSummary = {
  total: number;
  validResults: number;
  verdictCorrect: number;
  coverageCorrect: number;
  verdictAccuracy: number;
  coverageAccuracy: number;
  validVerdictAccuracy: number | null;
  validCoverageAccuracy: number | null;
  averageLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  failures: Record<FailureCategory, number>;
};

export type RegressionAggregate = {
  overall: AttemptSummary;
  byConfiguration: Record<string, AttemptSummary>;
  byCase: Record<string, AttemptSummary>;
};

const FAILURE_CATEGORIES: FailureCategory[] = [
  'UNKNOWN_VS_FALSE_FAILURE',
  'RELEVANCE_QUESTION_FAILURE',
  'SEMANTIC_ENTAILMENT_FAILURE',
  'BOTH_MIXED_PROPOSITION_FAILURE',
  'BOTH_AMBIGUITY_FAILURE',
  'BOTH_OVER_TRIGGER',
  'KP_OVER_TRIGGER',
  'KP_UNDER_TRIGGER',
  'KP_WRONG_ID',
  'MULTI_KP_FAILURE',
  'SCHEMA_FAILURE',
  'TRANSPORT_FAILURE',
];

function emptyFailures(): Record<FailureCategory, number> {
  return Object.fromEntries(FAILURE_CATEGORIES.map((category) => [category, 0])) as Record<FailureCategory, number>;
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? null;
}

function summarizeGroup(attempts: RegressionAttempt[]): AttemptSummary {
  const latencies = attempts.flatMap(({ latencyMs }) => latencyMs === null ? [] : [latencyMs]);
  const inputTokens = attempts.reduce((sum, attempt) => sum + (attempt.inputTokens ?? 0), 0);
  const outputTokens = attempts.reduce((sum, attempt) => sum + (attempt.outputTokens ?? 0), 0);
  const costValues = attempts.flatMap(({ costUsd }) => costUsd === null ? [] : [costUsd]);
  const failures = emptyFailures();
  for (const attempt of attempts) {
    for (const category of attempt.failureCategories) failures[category] += 1;
  }
  const total = attempts.length;
  const validAttempts = attempts.filter(({ schemaValid }) => schemaValid);
  return {
    total,
    validResults: attempts.filter(({ schemaValid }) => schemaValid).length,
    verdictCorrect: attempts.filter(({ verdictCorrect }) => verdictCorrect).length,
    coverageCorrect: attempts.filter(({ coverageCorrect }) => coverageCorrect).length,
    verdictAccuracy: total ? attempts.filter(({ verdictCorrect }) => verdictCorrect).length / total : 0,
    coverageAccuracy: total ? attempts.filter(({ coverageCorrect }) => coverageCorrect).length / total : 0,
    validVerdictAccuracy: validAttempts.length ? validAttempts.filter(({ verdictCorrect }) => verdictCorrect).length / validAttempts.length : null,
    validCoverageAccuracy: validAttempts.length ? validAttempts.filter(({ coverageCorrect }) => coverageCorrect).length / validAttempts.length : null,
    averageLatencyMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    inputTokens: attempts.some(({ inputTokens: value }) => value !== null) ? inputTokens : null,
    outputTokens: attempts.some(({ outputTokens: value }) => value !== null) ? outputTokens : null,
    costUsd: costValues.length ? costValues.reduce((sum, value) => sum + value, 0) : null,
    failures,
  };
}

export function summarizeAttempts(attempts: RegressionAttempt[]): RegressionAggregate {
  const byConfiguration: Record<string, RegressionAttempt[]> = {};
  const byCase: Record<string, RegressionAttempt[]> = {};
  for (const attempt of attempts) {
    (byConfiguration[attempt.configuration] ??= []).push(attempt);
    (byCase[attempt.caseId] ??= []).push(attempt);
  }
  return {
    overall: summarizeGroup(attempts),
    byConfiguration: Object.fromEntries(Object.entries(byConfiguration).map(([key, group]) => [key, summarizeGroup(group)])),
    byCase: Object.fromEntries(Object.entries(byCase).map(([key, group]) => [key, summarizeGroup(group)])),
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(1);
}

function formatFailureSummary(failures: Record<FailureCategory, number>): string {
  return Object.entries(failures)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `${category}=${count}`)
    .join(', ') || 'none';
}

function caseAccuracy(aggregate: RegressionAggregate, caseId: string): string {
  const summary = aggregate.byCase[caseId];
  return summary ? `${formatPercent(summary.verdictAccuracy)} verdict / ${formatPercent(summary.coverageAccuracy)} KP` : 'not run';
}

export type RegressionReportMetadata = {
  generatedAt: string;
  promptVersion: string;
  schemaVersion: string;
  rounds: number;
  configurations: Array<{ label: string; provider: string; model: string; reasoningEffort: string }>;
  fixturePath: string;
  frozenCommit?: string | null;
};

export function renderRegressionReport(
  fixture: QuestionJudgeGoldFixture,
  attempts: RegressionAttempt[],
  metadata: RegressionReportMetadata,
): string {
  const aggregate = summarizeAttempts(attempts);
  const lines: string[] = [
    '# Mosquito Question Judge v4 — 25-case, 6-configuration, 5-round comparison',
    '',
    `- Generated: ${metadata.generatedAt}`,
    `- Fixture: ${metadata.fixturePath}`,
    `- Prompt: ${metadata.promptVersion}`,
    `- Schema: ${metadata.schemaVersion}`,
    `- Rounds: ${metadata.rounds}`,
    `- Attempts: ${attempts.length}`,
    `- Frozen commit: ${metadata.frozenCommit ?? 'not recorded'}`,
    '',
    '## Fixed key points',
    '',
    ...fixture.key_points.map(({ id, text }) => `- ${id}: ${text}`),
    '',
    '## Configuration comparison',
    '',
    '| Configuration | Attempts | Valid | Verdict accuracy | Valid verdict accuracy | KP coverage accuracy | Valid KP coverage accuracy | Avg ms | P50 ms | P95 ms | Input tokens | Output tokens | Failures |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const configuration of metadata.configurations) {
    const summary = aggregate.byConfiguration[configuration.label];
    if (!summary) continue;
    lines.push(`| ${configuration.label} | ${summary.total} | ${summary.validResults} | ${formatPercent(summary.verdictAccuracy)} | ${summary.validVerdictAccuracy === null ? 'N/A' : formatPercent(summary.validVerdictAccuracy)} | ${formatPercent(summary.coverageAccuracy)} | ${summary.validCoverageAccuracy === null ? 'N/A' : formatPercent(summary.validCoverageAccuracy)} | ${formatNumber(summary.averageLatencyMs)} | ${formatNumber(summary.p50LatencyMs)} | ${formatNumber(summary.p95LatencyMs)} | ${summary.inputTokens ?? 'N/A'} | ${summary.outputTokens ?? 'N/A'} | ${formatFailureSummary(summary.failures)} |`);
  }
  lines.push(
    '',
    '## Overall',
    '',
    `- Verdict accuracy: ${formatPercent(aggregate.overall.verdictAccuracy)} (${aggregate.overall.verdictCorrect}/${aggregate.overall.total})`,
    `- Key-point coverage accuracy: ${formatPercent(aggregate.overall.coverageAccuracy)} (${aggregate.overall.coverageCorrect}/${aggregate.overall.total})`,
    `- Valid result rate: ${formatPercent(aggregate.overall.total ? aggregate.overall.validResults / aggregate.overall.total : 0)}`,
    `- Latency: average ${formatNumber(aggregate.overall.averageLatencyMs)} ms, P50 ${formatNumber(aggregate.overall.p50LatencyMs)} ms, P95 ${formatNumber(aggregate.overall.p95LatencyMs)} ms`,
    `- Token/cost fields are authoritative provider values only; absent values remain N/A.`,
    '',
    '## Case stability and failure categories',
    '',
    '| Case | Expected verdict | Expected KP | Verdict accuracy | KP coverage accuracy | Failures |',
    '| --- | --- | --- | ---: | ---: | --- |',
  );
  for (const testCase of fixture.cases) {
    const summary = aggregate.byCase[testCase.id];
    if (!summary) continue;
    lines.push(`| ${testCase.id} | ${testCase.expected_verdict} | ${testCase.expected_coverage.join(', ') || '—'} | ${formatPercent(summary.verdictAccuracy)} | ${formatPercent(summary.coverageAccuracy)} | ${formatFailureSummary(summary.failures)} |`);
  }
  const reliableCandidates = metadata.configurations
    .map((configuration) => ({ configuration, summary: aggregate.byConfiguration[configuration.label] }))
    .filter(({ summary }) => summary && summary.validResults / summary.total >= 0.9)
    .sort((left, right) => (right.summary!.validCoverageAccuracy ?? -1) - (left.summary!.validCoverageAccuracy ?? -1));
  const strongestReliable = reliableCandidates[0];
  lines.push(
    '',
    '## Regression checks',
    '',
    `- Unknown/unimportant attributes (disability, self-hate, gender): ${caseAccuracy(aggregate, 'disability')}; ${caseAccuracy(aggregate, 'self-hate')}; ${caseAccuracy(aggregate, 'gender')}.`,
    `- Relevance-direction questions (animal-related, revenge-related): ${caseAccuracy(aggregate, 'animal-related')}; ${caseAccuracy(aggregate, 'revenge-related')}.`,
    `- Partial/contextual coverage (burning-is-coil, smell-from-coil, hit-mosquito): ${caseAccuracy(aggregate, 'burning-is-coil')}; ${caseAccuracy(aggregate, 'smell-from-coil')}; ${caseAccuracy(aggregate, 'hit-mosquito')}.`,
    `- Multi-key-point coverage (multi-kp-2-3, full-chain): ${caseAccuracy(aggregate, 'multi-kp-2-3')}; ${caseAccuracy(aggregate, 'full-chain')}.`,
    `- BOTH cases (mixed-with-KP plus three ambiguity cases): ${caseAccuracy(aggregate, 'both-with-kp')}; ${caseAccuracy(aggregate, 'intentional-self-hit-ambiguous')}; ${caseAccuracy(aggregate, 'hit-self-target-ambiguous')}; ${caseAccuracy(aggregate, 'violent-behavior-ambiguous')}.`,
    '',
    '## Recommendation',
    '',
    ...(strongestReliable ? [
      `- On this puzzle, ${strongestReliable.configuration.label} has the strongest valid-result KP coverage accuracy among configurations with at least 90% valid results (${formatPercent(strongestReliable.summary!.validCoverageAccuracy ?? 0)}; valid rate ${formatPercent(strongestReliable.summary!.validResults / strongestReliable.summary!.total)}).`,
    ] : []),
    '- Do not route permanently from this single puzzle. The next experiment should use a multi-puzzle gold suite with the same independent verdict/KP metrics.',
    '- Treat DeepSeek Pro/high as a reliability concern in this run because its invalid-result rate materially reduces usable evidence; do not infer semantic superiority from its valid rows alone.',
    '',
    '## Interpretation',
    '',
    '- Valid schema results with semantic misses are model/policy observations; transport, timeout, and schema failures are runtime reliability observations.',
    '- Verdict correctness and key-point coverage are evaluated independently. A correct verdict with no KP, or a BOTH verdict with a correctly covered true proposition, is intentional.',
    '- This single-puzzle comparison is evidence for the next experiment, not a permanent cross-game model-routing decision.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

export type RegressionResultsDocument = {
  dataset: string;
  generatedAt: string;
  promptVersion: string;
  schemaVersion: string;
  rounds: number;
  configurations: RegressionReportMetadata['configurations'];
  attempts: RegressionAttempt[];
};

export function serializeRegressionResults(
  attempts: RegressionAttempt[],
  metadata: RegressionReportMetadata,
): string {
  const document: RegressionResultsDocument = {
    dataset: 'mosquito_question_judge_regression_v4',
    generatedAt: metadata.generatedAt,
    promptVersion: metadata.promptVersion,
    schemaVersion: metadata.schemaVersion,
    rounds: metadata.rounds,
    configurations: metadata.configurations,
    attempts,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
