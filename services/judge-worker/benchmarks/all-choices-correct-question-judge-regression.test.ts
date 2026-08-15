import { describe, expect, it } from 'vitest';
import {
  ALL_CHOICES_FIXED_KEY_POINTS,
  loadAllChoicesCorrectFixture,
  normalizeAllChoicesFixture,
  validateAllChoicesCorrectFixture,
} from './all-choices-correct-question-judge-regression.js';
import { classifyFailure } from './question-judge-regression.js';

describe('all choices correct question judge fixture', () => {
  it('loads the supplied 30-case gold with its approved distributions', async () => {
    const fixture = await loadAllChoicesCorrectFixture();

    expect(fixture.dataset).toBe('all_choices_correct_question_judge_regression_v1');
    expect(fixture.cases).toHaveLength(30);
    expect(fixture.summary.verdictDistribution).toEqual({ YES: 15, NO: 9, IRRELEVANT: 5, BOTH: 1 });
    expect(fixture.summary.coverageHitCounts).toEqual({ KP1: 2, KP2: 5, KP3: 2 });
    expect(fixture.key_points).toEqual([
      { id: 'KP1', content: '所谓的“选择题”实际是凶手让被害人的母亲猜她的孩子在哪个房间。' },
      { id: 'KP2', content: '被害人的尸体已经被分尸。' },
      { id: 'KP3', content: '尸块被分散藏在多个不同房间，因此母亲无论选择哪个房间，都能被凶手说成答对。' },
    ]);
  });

  it('rejects a changed verdict distribution or unknown coverage id', async () => {
    const fixture = await loadAllChoicesCorrectFixture();
    const changed = structuredClone(fixture) as unknown as Record<string, unknown>;
    const cases = changed.cases as Array<Record<string, unknown>>;
    cases[0] = { ...cases[0], expectedVerdict: 'YES' };

    expect(() => validateAllChoicesCorrectFixture(changed)).toThrow('summary verdict distribution');

    const invalidCoverage = structuredClone(fixture) as unknown as Record<string, unknown>;
    const invalidCases = invalidCoverage.cases as Array<Record<string, unknown>>;
    invalidCases[0] = { ...invalidCases[0], expectedCoverage: ['KP9'] };
    expect(() => validateAllChoicesCorrectFixture(invalidCoverage)).toThrow('invalid expectedCoverage');
  });

  it('normalizes camelCase gold fields without changing semantic content', async () => {
    const fixture = normalizeAllChoicesFixture(await loadAllChoicesCorrectFixture());
    expect(fixture.key_points).toEqual(ALL_CHOICES_FIXED_KEY_POINTS.map(({ label, content }) => ({ id: label, text: content })));
    expect(fixture.cases[0]).toMatchObject({
      id: 'school_exam',
      expected_verdict: 'NO',
      expected_coverage: [],
      policy_tags: ['surface_interpretation', 'implicit_competing_explanation'],
    });
  });

  it('classifies a surface-framing verdict miss separately from generic semantics', () => {
    const categories = classifyFailure(
      { verdict: 'IRRELEVANT', fully_covered_key_point_ids: [] },
      { expectedVerdict: 'NO', expectedCoverage: [], policyTags: ['surface_interpretation'] },
    );
    expect(categories).toContain('SURFACE_INTERPRETATION_FAILURE');
  });
});
