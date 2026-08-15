import { describe, expect, it, vi } from 'vitest';
import type { QuestionJudgeInput, QuestionJudgeResult } from '@turtle-soup/contracts';
import {
  ALL_CHOICES_MODEL_CONFIGURATIONS,
  ALL_CHOICES_FORMAL_REPORT_PATH,
  ALL_CHOICES_FORMAL_RESULTS_PATH,
  parseAllChoicesBenchmarkArgs,
  runAllChoicesQuestionJudgeRegression,
} from './all-choices-correct-question-judge-live.js';
import { loadAllChoicesCorrectFixture } from './all-choices-correct-question-judge-regression.js';

describe('all choices correct live benchmark runner', () => {
  it('uses only Luna none and medium and defaults to five rounds', () => {
    expect(ALL_CHOICES_MODEL_CONFIGURATIONS.map(({ label }) => label)).toEqual([
      'GPT-5.6 Luna / none',
      'GPT-5.6 Luna / medium',
    ]);
    expect(parseAllChoicesBenchmarkArgs([])).toEqual({ rounds: 5, caseIds: null, writeReports: true });
    expect(parseAllChoicesBenchmarkArgs(['--rounds', '1', '--cases', 'school_exam,on_test_paper', '--no-write'])).toEqual({
      rounds: 1,
      caseIds: ['school_exam', 'on_test_paper'],
      writeReports: false,
    });
  });

  it('runs 30 cases for five rounds in two configuration blocks', async () => {
    const fixture = await loadAllChoicesCorrectFixture();
    const calls: Array<{ label: string; input: QuestionJudgeInput }> = [];
    const factory = vi.fn((configuration: (typeof ALL_CHOICES_MODEL_CONFIGURATIONS)[number]) => ({
      judgeQuestion: async (input: QuestionJudgeInput): Promise<QuestionJudgeResult> => {
        calls.push({ label: configuration.label, input });
        const testCase = fixture.cases.find(({ question }) => question === input.current_message)!;
        const ids = testCase.expectedCoverage.map((label) => (
          fixture.key_points.find(({ id }) => id === label) ? `00000000-0000-4000-8000-00000000020${label.slice(-1)}` : label
        ));
        return { verdict: testCase.expectedVerdict, fully_covered_key_point_ids: ids };
      },
    }));
    const result = await runAllChoicesQuestionJudgeRegression({ rounds: 5, caseIds: null, writeReports: false }, {
      loadFixture: async () => fixture,
      judgeFactory: factory,
      log: () => undefined,
    });

    expect(result.attempts).toHaveLength(300);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(calls.slice(0, 150).every(({ label }) => label === 'GPT-5.6 Luna / none')).toBe(true);
    expect(calls.slice(150).every(({ label }) => label === 'GPT-5.6 Luna / medium')).toBe(true);
    expect(calls.every(({ input }) => Object.keys(input).sort().join('|') === 'current_message|full_solution|key_points|puzzle_surface')).toBe(true);
    expect(result.attempts.every(({ verdictCorrect, coverageCorrect, schemaValid }) => verdictCorrect && coverageCorrect && schemaValid)).toBe(true);
  });

  it('does not write in no-write mode and requires a frozen commit for reports', async () => {
    const fixture = await loadAllChoicesCorrectFixture();
    const writeFile = vi.fn();
    await runAllChoicesQuestionJudgeRegression({ rounds: 1, caseIds: ['school_exam'], writeReports: false }, {
      loadFixture: async () => fixture,
      judgeFactory: () => ({ judgeQuestion: async () => ({ verdict: 'NO', fully_covered_key_point_ids: [] }) }),
      writeFile,
      log: () => undefined,
    });
    expect(writeFile).not.toHaveBeenCalled();

    const factory = vi.fn();
    await expect(runAllChoicesQuestionJudgeRegression({ rounds: 1, caseIds: ['school_exam'], writeReports: true }, {
      loadFixture: async () => fixture,
      judgeFactory: factory,
      frozenCommit: '',
      log: () => undefined,
    })).rejects.toThrow('BENCHMARK_FROZEN_COMMIT');
    expect(factory).not.toHaveBeenCalled();
  });

  it('records a thrown provider result as one invalid attempt without selective retry', async () => {
    const fixture = await loadAllChoicesCorrectFixture();
    let calls = 0;
    const result = await runAllChoicesQuestionJudgeRegression({ rounds: 1, caseIds: ['school_exam', 'on_test_paper'], writeReports: false }, {
      loadFixture: async () => fixture,
      judgeFactory: () => ({
        judgeQuestion: async (input: QuestionJudgeInput) => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error('offline'), { code: 'TRANSPORT_ERROR' });
          return { verdict: 'NO', fully_covered_key_point_ids: [] };
        },
      }),
      log: () => undefined,
    });
    expect(result.attempts).toHaveLength(4);
    expect(calls).toBe(4);
    expect(result.attempts.filter(({ errorCode }) => errorCode === 'TRANSPORT_ERROR')).toHaveLength(1);
  });

  it('uses the requested formal artifact paths', () => {
    expect(ALL_CHOICES_FORMAL_REPORT_PATH).toContain('all-choices-correct-question-judge-v6-30case-2config-5round.md');
    expect(ALL_CHOICES_FORMAL_RESULTS_PATH).toContain('all-choices-correct-question-judge-v6-30case-2config-5round.results.json');
  });
});
