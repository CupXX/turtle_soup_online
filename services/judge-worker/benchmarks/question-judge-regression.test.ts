import { describe, expect, it } from 'vitest';
import {
  CANONICAL_FULL_SOLUTION,
  CANONICAL_KEY_POINTS,
  CANONICAL_PUZZLE_SURFACE,
  loadQuestionJudgeFixture,
  classifyFailure,
  evaluateAttempt,
  renderRegressionReport,
  sameSet,
  serializeRegressionResults,
  summarizeAttempts,
} from './question-judge-regression.js';
import type { RegressionAttempt } from './question-judge-regression.js';
import type { QuestionJudgeResult } from '@turtle-soup/contracts';

describe('question judge 25-case fixture', () => {
  it('locks the approved case count, verdict distribution, and unique IDs', async () => {
    const fixture = await loadQuestionJudgeFixture();
    expect(fixture.cases).toHaveLength(25);
    expect(new Set(fixture.cases.map(({ id }) => id)).size).toBe(25);
    expect(Object.fromEntries(fixture.verdict_enum.map((verdict) => [
      verdict,
      fixture.cases.filter((testCase) => testCase.expected_verdict === verdict).length,
    ]))).toEqual({ YES: 13, NO: 5, BOTH: 4, IRRELEVANT: 3 });
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
    expect(byId.get('intentional-self-hit-ambiguous')).toMatchObject({ expected_verdict: 'BOTH', expected_coverage: [] });
    expect(byId.get('violent-behavior-ambiguous')).toMatchObject({ expected_verdict: 'BOTH', expected_coverage: [] });
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
    expect(aggregate.byConfiguration['Test / none'].p95LatencyMs).toBe(12);
    const metadata = {
      generatedAt: '2026-08-15T00:00:00.000Z',
      promptVersion: 'question-judge-v3',
      schemaVersion: 'question-judge-v1',
      rounds: 1,
      configurations: [{ label: 'Test / none', provider: 'test', model: 'test-model', reasoningEffort: 'none' }],
      fixturePath: 'fixture.json',
      frozenCommit: null,
    };
    const report = renderRegressionReport(await loadQuestionJudgeFixture(), attempts, metadata);
    expect(report).toContain('Test / none');
    expect(report).not.toContain('这个人被蚊子叮醒');
    expect(JSON.parse(serializeRegressionResults(attempts, metadata)).attempts).toHaveLength(1);
  });
});
