import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROGRESS_SUMMARY_PROMPT_VERSION } from '../skills/progress-summary.js';
import { fingerprintProgressSummarySource } from './progress-summary-queue.js';

const questions = [
  { sequence_no: 4, question: '问题一', verdict: 'YES' as const },
  { sequence_no: 9, question: '问题二', verdict: 'NO' as const },
  { sequence_no: 12, question: '问题三', verdict: 'IRRELEVANT' as const },
];

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

describe('progress summary policy fingerprint', () => {
  it('invalidates an unchanged public source when the summary policy version changes', () => {
    const tuples = questions.map(({ sequence_no, question, verdict }) => [sequence_no, question, verdict]);
    const legacyFingerprint = sha256(tuples);
    const versionedFingerprint = sha256({
      policy_version: PROGRESS_SUMMARY_PROMPT_VERSION,
      questions: tuples,
    });

    expect(PROGRESS_SUMMARY_PROMPT_VERSION).toBe('progress-summary-v2');
    expect(fingerprintProgressSummarySource(questions)).toBe(versionedFingerprint);
    expect(fingerprintProgressSummarySource(questions)).not.toBe(legacyFingerprint);
  });
});
