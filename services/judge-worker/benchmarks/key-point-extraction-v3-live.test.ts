import { describe, expect, it, vi } from 'vitest';
import type { KeyPointExtractionInput, KeyPointExtractionResult } from '@turtle-soup/contracts';
import {
  EXTRACTION_MODEL_CONFIGURATION,
  EXTRACTION_FORMAL_REPORT_PATH,
  parseExtractionBenchmarkArgs,
  runKeyPointExtractionV3Regression,
} from './key-point-extraction-v3-live.js';
import { loadExtractionFixture } from './key-point-extraction-v3-live.js';

describe('key point extraction v3 benchmark runner', () => {
  it('uses Luna medium and defaults to five rounds per puzzle', () => {
    expect(EXTRACTION_MODEL_CONFIGURATION).toEqual({ label: 'GPT-5.6 Luna / medium', provider: 'openai', model: 'gpt-5.6-luna', reasoningEffort: 'medium' });
    expect(parseExtractionBenchmarkArgs([])).toEqual({ rounds: 5, writeReports: true });
    expect(parseExtractionBenchmarkArgs(['--rounds', '1', '--no-write'])).toEqual({ rounds: 1, writeReports: false });
  });

  it('runs both puzzles for five rounds and records valid structured results', async () => {
    const fixture = await loadExtractionFixture();
    const calls: KeyPointExtractionInput[] = [];
    const factory = vi.fn(() => ({
      extractKeyPoints: async (input: KeyPointExtractionInput): Promise<KeyPointExtractionResult> => {
        calls.push(input);
        return { key_points: [{ content: '隐藏事实一' }, { content: '隐藏事实二' }, { content: '隐藏事实三' }] };
      },
    }));
    const result = await runKeyPointExtractionV3Regression({ rounds: 5, writeReports: false }, {
      loadFixture: async () => fixture,
      judgeFactory: factory,
      log: () => undefined,
    });

    expect(result.attempts).toHaveLength(10);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(10);
    expect(result.attempts.every(({ schemaValid, pointCount }) => schemaValid && pointCount === 3)).toBe(true);
  });

  it('never writes in no-write mode', async () => {
    const fixture = await loadExtractionFixture();
    const writeFile = vi.fn();
    await runKeyPointExtractionV3Regression({ rounds: 1, writeReports: false }, {
      loadFixture: async () => fixture,
      judgeFactory: () => ({ extractKeyPoints: async () => ({ key_points: [{ content: '一' }, { content: '二' }, { content: '三' }] }) }),
      writeFile,
      log: () => undefined,
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('uses the extraction report artifact path', () => {
    expect(EXTRACTION_FORMAL_REPORT_PATH).toContain('key-point-extraction-v3-regression.md');
  });
});
