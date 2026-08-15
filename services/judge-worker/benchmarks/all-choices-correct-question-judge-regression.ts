import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { JudgeVerdict } from '@turtle-soup/contracts';
import type { QuestionJudgeGoldCase, QuestionJudgeGoldFixture } from './question-judge-regression.js';

export const ALL_CHOICES_CORRECT_DATASET = 'all_choices_correct_question_judge_regression_v1' as const;
export const ALL_CHOICES_CORRECT_SURFACE = '有一道选择题，不论选什么都是对的';
export const ALL_CHOICES_CORRECT_SOLUTION = '凶手将尸块藏在了不同的房间里，对被害人的妈妈说，猜猜你的孩子在哪间屋子。母亲不论做出任何选择，凶手都说，回答正确。母亲因此得知自己的孩子已经被彻底杀害，残忍分尸。';
export const ALL_CHOICES_FIXED_KEY_POINTS = [
  { label: 'KP1', id: '00000000-0000-4000-8000-000000000201', content: '所谓的“选择题”实际是凶手让被害人的母亲猜她的孩子在哪个房间。' },
  { label: 'KP2', id: '00000000-0000-4000-8000-000000000202', content: '被害人的尸体已经被分尸。' },
  { label: 'KP3', id: '00000000-0000-4000-8000-000000000203', content: '尸块被分散藏在多个不同房间，因此母亲无论选择哪个房间，都能被凶手说成答对。' },
] as const;

const VERDICTS = ['YES', 'NO', 'BOTH', 'IRRELEVANT'] as const satisfies readonly JudgeVerdict[];
const KEY_POINT_LABELS = ['KP1', 'KP2', 'KP3'] as const;
const DEFAULT_FIXTURE_URL = new URL('./fixtures/all-choices-correct-question-judge-v1-30cases.json', import.meta.url);

export type AllChoicesCorrectCase = {
  id: string;
  question: string;
  expectedVerdict: JudgeVerdict;
  expectedCoverage: string[];
  policyTags: string[];
};

export type AllChoicesCorrectFixture = {
  dataset: typeof ALL_CHOICES_CORRECT_DATASET;
  puzzle_surface: string;
  full_solution: string;
  key_points: Array<{ id: string; content: string }>;
  cases: AllChoicesCorrectCase[];
  summary: {
    caseCount: 30;
    verdictDistribution: Record<JudgeVerdict, number>;
    coverageHitCounts: Record<'KP1' | 'KP2' | 'KP3', number>;
    designNote: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`invalid all-choices-correct Question Judge fixture: ${message}`);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} must be a non-empty string`);
}

export function validateAllChoicesCorrectFixture(value: unknown): AllChoicesCorrectFixture {
  if (!isRecord(value)) fail('fixture must be an object');
  if (value.dataset !== ALL_CHOICES_CORRECT_DATASET) fail('dataset differs from the approved dataset');
  if (value.puzzle_surface !== ALL_CHOICES_CORRECT_SURFACE) fail('puzzle_surface differs from the approved surface');
  if (value.full_solution !== ALL_CHOICES_CORRECT_SOLUTION) fail('full_solution differs from the approved solution');
  if (!Array.isArray(value.key_points) || value.key_points.length !== 3) fail('key_points must contain exactly three points');
  const keyPoints = value.key_points;
  const expectedKeyPoints = ALL_CHOICES_FIXED_KEY_POINTS.map(({ label, content }) => ({ id: label, content }));
  for (const [index, point] of keyPoints.entries()) {
    if (!isRecord(point) || point.id !== expectedKeyPoints[index]?.id || point.content !== expectedKeyPoints[index]?.content) {
      fail(`key_points[${index}] differs from the approved semantic key point`);
    }
  }
  if (!Array.isArray(value.cases) || value.cases.length !== 30) fail('case count must be exactly 30');
  const cases: AllChoicesCorrectCase[] = [];
  const seenIds = new Set<string>();
  for (const [index, rawCase] of value.cases.entries()) {
    if (!isRecord(rawCase)) fail(`case ${index + 1} must be an object`);
    assertString(rawCase.id, `case ${index + 1}.id`);
    assertString(rawCase.question, `${rawCase.id}.question`);
    if (seenIds.has(rawCase.id)) fail(`duplicate case id: ${rawCase.id}`);
    seenIds.add(rawCase.id);
    if (!VERDICTS.includes(rawCase.expectedVerdict as JudgeVerdict)) fail(`${rawCase.id} has an invalid expectedVerdict`);
    if (!Array.isArray(rawCase.expectedCoverage)) fail(`${rawCase.id} expectedCoverage must be an array`);
    const coverage = rawCase.expectedCoverage as unknown[];
    if (new Set(coverage).size !== coverage.length || coverage.some((id) => !KEY_POINT_LABELS.includes(id as (typeof KEY_POINT_LABELS)[number]))) {
      fail(`${rawCase.id} has an invalid expectedCoverage`);
    }
    if (!Array.isArray(rawCase.policyTags) || rawCase.policyTags.some((tag) => typeof tag !== 'string' || !tag)) {
      fail(`${rawCase.id} policyTags must be non-empty strings`);
    }
    cases.push({
      id: rawCase.id,
      question: rawCase.question,
      expectedVerdict: rawCase.expectedVerdict as JudgeVerdict,
      expectedCoverage: coverage as string[],
      policyTags: rawCase.policyTags as string[],
    });
  }
  if (!isRecord(value.summary)) fail('summary must be an object');
  if (value.summary.caseCount !== 30) fail('summary caseCount must be 30');
  if (!isRecord(value.summary.verdictDistribution) || !isRecord(value.summary.coverageHitCounts) || typeof value.summary.designNote !== 'string') {
    fail('summary fields are invalid');
  }
  const verdictDistribution = { YES: 0, NO: 0, BOTH: 0, IRRELEVANT: 0 } satisfies Record<JudgeVerdict, number>;
  const coverageHitCounts = { KP1: 0, KP2: 0, KP3: 0 };
  for (const testCase of cases) {
    verdictDistribution[testCase.expectedVerdict] += 1;
    for (const id of testCase.expectedCoverage) coverageHitCounts[id as keyof typeof coverageHitCounts] += 1;
  }
  for (const verdict of VERDICTS) {
    if (value.summary.verdictDistribution[verdict] !== verdictDistribution[verdict]) fail(`summary verdict distribution does not match ${verdict}`);
  }
  for (const id of KEY_POINT_LABELS) {
    if (value.summary.coverageHitCounts[id] !== coverageHitCounts[id]) fail(`summary coverage counts do not match ${id}`);
  }
  return {
    dataset: ALL_CHOICES_CORRECT_DATASET,
    puzzle_surface: ALL_CHOICES_CORRECT_SURFACE,
    full_solution: ALL_CHOICES_CORRECT_SOLUTION,
    key_points: keyPoints as Array<{ id: string; content: string }>,
    cases,
    summary: {
      caseCount: 30,
      verdictDistribution,
      coverageHitCounts,
      designNote: value.summary.designNote,
    },
  };
}

export async function loadAllChoicesCorrectFixture(path = fileURLToPath(DEFAULT_FIXTURE_URL)): Promise<AllChoicesCorrectFixture> {
  const raw = await readFile(path, 'utf8');
  return validateAllChoicesCorrectFixture(JSON.parse(raw) as unknown);
}

export function normalizeAllChoicesFixture(fixture: AllChoicesCorrectFixture): QuestionJudgeGoldFixture {
  const cases: QuestionJudgeGoldCase[] = fixture.cases.map((testCase) => ({
    id: testCase.id,
    question: testCase.question,
    expected_verdict: testCase.expectedVerdict,
    expected_coverage: testCase.expectedCoverage,
    policy_tags: testCase.policyTags,
    gold_rationale: '',
  }));
  return {
    dataset_name: fixture.dataset,
    purpose: fixture.summary.designNote,
    puzzle_id: 'all-choices-correct',
    puzzle_surface: fixture.puzzle_surface,
    full_solution: fixture.full_solution,
    verdict_enum: [...VERDICTS],
    key_points: fixture.key_points.map(({ id, content }) => ({ id, text: content })),
    policy_summary: {},
    cases,
  };
}
