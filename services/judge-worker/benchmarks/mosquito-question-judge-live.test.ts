import { describe, expect, it, vi } from 'vitest';
import type { QuestionJudgeInput, QuestionJudgeResult } from '@turtle-soup/contracts';
import {
  MODEL_CONFIGURATIONS,
  FIXED_KEY_POINTS,
  parseLiveBenchmarkArgs,
  runQuestionJudgeRegression,
} from './mosquito-question-judge-live.js';
import { loadQuestionJudgeFixture } from './question-judge-regression.js';

describe('live question judge benchmark runner', () => {
  it('parses rounds, case filters, and report mode', () => {
    expect(parseLiveBenchmarkArgs(['--rounds', '5'])).toEqual({ rounds: 5, caseIds: null, writeReports: true });
    expect(parseLiveBenchmarkArgs(['--rounds', '1', '--cases', 'disability,self-hate-cause', '--no-write'])).toEqual({
      rounds: 1,
      caseIds: ['disability', 'self-hate-cause'],
      writeReports: false,
    });
  });

  it('runs all six configurations sequentially over 25 cases for five rounds', async () => {
    const fixture = await loadQuestionJudgeFixture();
    const calls: Array<{ label: string; input: QuestionJudgeInput }> = [];
    const factory = vi.fn((configuration: (typeof MODEL_CONFIGURATIONS)[number]) => ({
      judgeQuestion: async (input: QuestionJudgeInput): Promise<QuestionJudgeResult> => {
        calls.push({ label: configuration.label, input });
        const testCase = fixture.cases.find(({ question }) => question === input.current_message)!;
        const ids = testCase.expected_coverage.map((label) => FIXED_KEY_POINTS.find(({ label: candidate }) => candidate === label)!.id);
        return { verdict: testCase.expected_verdict, fully_covered_key_point_ids: ids };
      },
    }));
    const result = await runQuestionJudgeRegression({ rounds: 5, caseIds: null, writeReports: false }, {
      loadFixture: async () => fixture,
      judgeFactory: factory,
      log: () => undefined,
    });
    expect(result.attempts).toHaveLength(750);
    expect(factory).toHaveBeenCalledTimes(6);
    expect(calls).toHaveLength(750);
    expect(calls[0]?.label).toBe('DeepSeek Flash / off');
    expect(calls[125]?.label).toBe('DeepSeek Flash / high');
    expect(calls[500]?.label).toBe('GPT-5.6 Luna / none');
    expect(calls.every(({ input }) => Object.keys(input).sort().join('|') === 'current_message|full_solution|key_points|puzzle_surface')).toBe(true);
    expect(calls.every(({ input }) => JSON.stringify(input.key_points) === JSON.stringify(FIXED_KEY_POINTS.map(({ id, content }) => ({ id, content }))))).toBe(true);
    expect(result.attempts.every(({ verdictCorrect, coverageCorrect, schemaValid }) => verdictCorrect && coverageCorrect && schemaValid)).toBe(true);
  });

  it('records one thrown result as a failure without retry and never writes with no-write', async () => {
    const fixture = await loadQuestionJudgeFixture();
    const writeFile = vi.fn();
    let calls = 0;
    const result = await runQuestionJudgeRegression({ rounds: 1, caseIds: ['dead', 'bitten-awake'], writeReports: false }, {
      loadFixture: async () => fixture,
      judgeFactory: () => ({
        judgeQuestion: async (input) => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error('offline'), { code: 'TRANSPORT_ERROR' });
          const testCase = fixture.cases.find(({ question }) => question === input.current_message)!;
          const ids = testCase.expected_coverage.map((label) => FIXED_KEY_POINTS.find(({ label: candidate }) => candidate === label)!.id);
          return { verdict: testCase.expected_verdict, fully_covered_key_point_ids: ids };
        },
      }),
      writeFile,
      log: () => undefined,
    });
    expect(result.attempts).toHaveLength(12);
    expect(result.attempts.filter(({ errorCode }) => errorCode === 'TRANSPORT_ERROR')).toHaveLength(1);
    expect(calls).toBe(12);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
