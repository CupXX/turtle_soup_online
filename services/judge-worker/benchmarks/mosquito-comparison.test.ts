import { describe, expect, it } from 'vitest';
import {
  evaluateCase,
  renderComparisonReport,
  summarize,
  type ComparisonRow,
} from './mosquito-comparison.js';

describe('mosquito comparison scoring', () => {
  it('scores verdict and key-point coverage independently for BOTH', () => {
    expect(evaluateCase(
      { verdict: 'BOTH', fully_covered_key_point_ids: ['kp1'] },
      { verdict: 'BOTH', coveredIds: ['kp1'] },
    )).toEqual({ verdictCorrect: true, coverageCorrect: true });
  });

  it('uses set equality for coverage and reports separate accuracy', () => {
    expect(evaluateCase(
      { verdict: 'YES', fully_covered_key_point_ids: ['kp2', 'kp1'] },
      { verdict: 'YES', coveredIds: ['kp1', 'kp2'] },
    )).toEqual({ verdictCorrect: true, coverageCorrect: true });
    expect(summarize([
      { verdictCorrect: true, coverageCorrect: false },
      { verdictCorrect: true, coverageCorrect: true },
    ])).toEqual({ verdict: '2/2', coverage: '1/2' });
  });

  it('renders N/A for unavailable usage and never includes the API key', () => {
    const rows: ComparisonRow[] = [{
      questionId: 'case-1',
      question: '是不是点了蚊香？',
      expectedVerdict: 'YES',
      expectedCoveredIds: ['kp3'],
      configuration: 'Pro + thinking',
      actualVerdict: 'YES',
      actualCoveredIds: ['kp3'],
      verdictCorrect: true,
      coverageCorrect: true,
      schemaValid: true,
      latencyMs: 42,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    }];
    const report = renderComparisonReport({
      extractedKeyPoints: ['他是被蚊子叮醒的。'],
      rows,
      apiKey: 'do-not-print-this-key',
      generatedAt: '2026-08-15T00:00:00.000Z',
    });

    expect(report).toContain('N/A');
    expect(report).not.toContain('do-not-print-this-key');
    expect(report).toContain('Verdict accuracy');
    expect(report).toContain('KP coverage accuracy');
  });
});
