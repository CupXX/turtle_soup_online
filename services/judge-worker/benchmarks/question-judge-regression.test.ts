import { describe, expect, it } from 'vitest';
import {
  CANONICAL_FULL_SOLUTION,
  CANONICAL_KEY_POINTS,
  CANONICAL_PUZZLE_SURFACE,
  loadQuestionJudgeFixture,
  classifyFailure,
  evaluateAttempt,
  renderRegressionReport,
  renderVersionComparison,
  sameSet,
  serializeRegressionResults,
  summarizeAttempts,
} from './question-judge-regression.js';
import type { RegressionAttempt } from './question-judge-regression.js';
import type { QuestionJudgeResult } from '@turtle-soup/contracts';

describe('question judge 25-case fixture', () => {
  it('locks the approved case count, verdict distribution, and unique IDs', async () => {
    const fixture = await loadQuestionJudgeFixture();
    expect(fixture.dataset_name).toBe('mosquito_question_judge_regression_v5');
    expect(fixture.cases).toHaveLength(25);
    expect(new Set(fixture.cases.map(({ id }) => id)).size).toBe(25);
    expect(Object.fromEntries(fixture.verdict_enum.map((verdict) => [
      verdict,
      fixture.cases.filter((testCase) => testCase.expected_verdict === verdict).length,
    ]))).toEqual({ YES: 15, NO: 6, BOTH: 2, IRRELEVANT: 2 });
  });

  it('locks the canonical puzzle inputs, disputed cases, and three fixed key points', async () => {
    const fixture = await loadQuestionJudgeFixture();
    const byId = new Map(fixture.cases.map((testCase) => [testCase.id, testCase]));

    expect(fixture.puzzle_surface).toBe(CANONICAL_PUZZLE_SURFACE);
    expect(fixture.full_solution).toBe(CANONICAL_FULL_SOLUTION);
    expect(fixture.key_points).toEqual(CANONICAL_KEY_POINTS);
    expect(byId.get('burning-is-coil')).toMatchObject({ expected_verdict: 'YES', expected_coverage: ['KP3'] });
    expect(byId.get('smell-from-coil')).toMatchObject({
      expected_verdict: 'YES',
      expected_coverage: [],
      policy_tags: ['semantic_paraphrase', 'partial_fact_no_kp'],
    });
    expect(byId.get('self-hate')).toMatchObject({ expected_verdict: 'NO', expected_coverage: [] });
    expect(byId.get('intentional-self-hit-ambiguous')).toMatchObject({ expected_verdict: 'BOTH', expected_coverage: [] });
    expect(byId.get('hit-self-target-ambiguous')).toMatchObject({ expected_verdict: 'YES', expected_coverage: [] });
    expect(byId.get('violent-behavior-ambiguous')).toMatchObject({ expected_verdict: 'YES', expected_coverage: [] });
  });

  it('keeps verdict and coverage independent, including BOTH with a covered true proposition', () => {
    const actual: QuestionJudgeResult = { verdict: 'BOTH', fully_covered_key_point_ids: ['kp1'] };
    const evaluation = evaluateAttempt(actual, { expectedVerdict: 'BOTH', expectedCoverage: ['kp1'] });
    expect(evaluation.verdictCorrect).toBe(true);
    expect(evaluation.coverageCorrect).toBe(true);
    expect(sameSet(['kp1', 'kp2'], ['kp2', 'kp1'])).toBe(true);
    expect(sameSet(['kp1', 'kp1'], ['kp1'])).toBe(false);
  });

  it('classifies verdict and coverage failures separately', () => {
    expect(classifyFailure(
      { verdict: 'NO', fully_covered_key_point_ids: [] },
      { expectedVerdict: 'IRRELEVANT', expectedCoverage: [], policyTags: ['unknown_unimportant_attribute'] },
    )).toEqual(['UNKNOWN_VS_FALSE_FAILURE']);
    expect(classifyFailure(
      { verdict: 'BOTH', fully_covered_key_point_ids: [] },
      { expectedVerdict: 'YES', expectedCoverage: [], policyTags: [] },
    )).toEqual(['BOTH_OVER_TRIGGER']);
    expect(classifyFailure(
      { verdict: 'YES', fully_covered_key_point_ids: [] },
      { expectedVerdict: 'BOTH', expectedCoverage: [], policyTags: ['material_ambiguity'] },
    )).toEqual(['BOTH_AMBIGUITY_FAILURE']);
    expect(classifyFailure(
      { verdict: 'YES', fully_covered_key_point_ids: ['kp1'] },
      { expectedVerdict: 'YES', expectedCoverage: [], policyTags: [] },
    )).toEqual(['KP_OVER_TRIGGER']);
  });

  it('aggregates attempts and renders a report without hidden puzzle data', async () => {
    const attempts: RegressionAttempt[] = [{
      round: 1,
      configuration: 'Test / none',
      provider: 'test',
      model: 'test-model',
      reasoningEffort: 'none',
      caseId: 'dead',
      question: '这个人死了吗？',
      policyTags: ['relevant_false_hypothesis'],
      expectedVerdict: 'NO',
      expectedCoverage: [],
      actualVerdict: 'NO',
      actualCoverage: [],
      verdictCorrect: true,
      coverageCorrect: true,
      schemaValid: true,
      latencyMs: 12,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: null,
      errorCode: null,
      failureCategories: [],
    }];
    const aggregate = summarizeAttempts(attempts);
    expect(aggregate.overall.verdictAccuracy).toBe(1);
    expect(aggregate.overall.jointAccuracy).toBe(1);
    expect(aggregate.overall.validVerdictAccuracy).toBe(1);
    expect(aggregate.overall.validCoverageAccuracy).toBe(1);
    expect(aggregate.byConfiguration['Test / none'].p95LatencyMs).toBe(12);
    const metadata = {
      generatedAt: '2026-08-15T00:00:00.000Z',
      promptVersion: 'question-judge-v5',
      schemaVersion: 'question-judge-v1',
      rounds: 1,
      configurations: [{ label: 'Test / none', provider: 'test', model: 'test-model', reasoningEffort: 'none' }],
      fixturePath: 'fixture.json',
      frozenCommit: null,
    };
    const report = renderRegressionReport(await loadQuestionJudgeFixture(), attempts, metadata);
    expect(report).toContain('# Mosquito Question Judge v5');
    expect(report).toContain('Test / none');
    expect(report).toContain('Strict joint accuracy');
    expect(report).toContain('Actual verdict distribution');
    expect(report).toContain('| Test / none | 0 | 1 | 0 | 0 | 0 |');
    expect(report).toContain('Regression checks');
    expect(report).toContain('Recommendation');
    expect(report).not.toContain('这个人被蚊子叮醒');
    const serialized = JSON.parse(serializeRegressionResults(attempts, metadata));
    expect(serialized.dataset).toBe('mosquito_question_judge_regression_v5');
    expect(serialized.attempts).toHaveLength(1);
  });

  it('renders the five-case v4 to v5 comparison and checks previously stable cases for regression', async () => {
    const fixture = await loadQuestionJudgeFixture();
    const makeAttempt = (
      caseId: string,
      expectedVerdict: RegressionAttempt['expectedVerdict'],
      expectedCoverage: string[],
    ): RegressionAttempt => ({
      round: 1,
      configuration: 'Test / none',
      provider: 'test',
      model: 'test-model',
      reasoningEffort: 'none',
      caseId,
      question: fixture.cases.find((testCase) => testCase.id === caseId)?.question ?? caseId,
      policyTags: [],
      expectedVerdict,
      expectedCoverage,
      actualVerdict: expectedVerdict,
      actualCoverage: expectedCoverage,
      verdictCorrect: true,
      coverageCorrect: true,
      schemaValid: true,
      latencyMs: 1,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      errorCode: null,
      failureCategories: [],
    });
    const v4Attempts = [
      makeAttempt('self-hate', 'IRRELEVANT', []),
      makeAttempt('intentional-self-hit-ambiguous', 'BOTH', []),
      makeAttempt('hit-self-target-ambiguous', 'BOTH', []),
      makeAttempt('violent-behavior-ambiguous', 'BOTH', []),
      makeAttempt('burning-is-coil', 'YES', ['KP3']),
      makeAttempt('dead', 'NO', []),
    ];
    const v5Attempts = [
      makeAttempt('self-hate', 'NO', []),
      makeAttempt('intentional-self-hit-ambiguous', 'BOTH', []),
      makeAttempt('hit-self-target-ambiguous', 'YES', []),
      makeAttempt('violent-behavior-ambiguous', 'YES', []),
      makeAttempt('burning-is-coil', 'YES', ['KP3']),
      makeAttempt('dead', 'NO', []),
    ];
    const comparison = renderVersionComparison(v4Attempts, v5Attempts, fixture);
    expect(comparison).toContain('## v4 → v5 focused comparison');
    expect(comparison).toContain('| self-hate | IRRELEVANT / — | NO / — |');
    expect(comparison).toContain('| intentional-self-hit-ambiguous | BOTH / — | BOTH / — |');
    expect(comparison).toContain('| hit-self-target-ambiguous | BOTH / — | YES / — |');
    expect(comparison).toContain('| violent-behavior-ambiguous | BOTH / — | YES / — |');
    expect(comparison).toContain('| burning-is-coil | YES / KP3 | YES / KP3 |');
    expect(comparison).toContain('Previously 100%-stable non-focus cases: 1 checked; 0 regressed.');
  });
});
