import { describe, expect, it } from 'vitest';
import {
  JudgeValidationError,
  validateFinalAnswerResult,
  validateKeyPointExtractionResult,
  validateEvidenceQuestionResult,
  validateQuestionResult,
} from './validate-result.js';

const id1 = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';

describe('strict judge result validation', () => {
  it('requires atomic Evidence for every extracted key point', () => {
    expect(validateKeyPointExtractionResult({
      key_points: [
        { content: 'a', evidence: [{ content: 'a1' }] },
        { content: 'b', evidence: [{ content: 'b1' }, { content: 'b2' }] },
        { content: 'c', evidence: [{ content: 'c1' }] },
      ],
    })).toEqual({
      key_points: [
        { content: 'a', evidence: [{ content: 'a1' }] },
        { content: 'b', evidence: [{ content: 'b1' }, { content: 'b2' }] },
        { content: 'c', evidence: [{ content: 'c1' }] },
      ],
    });
    expect(() => validateKeyPointExtractionResult({
      key_points: [
        { content: 'a', evidence: [] },
        { content: 'b', evidence: [{ content: 'b1' }] },
        { content: 'c', evidence: [{ content: 'c1' }] },
      ],
    })).toThrow(/SCHEMA_INVALID/);
  });

  it('accepts exactly three extraction points and rejects extra fields', () => {
    expect(validateKeyPointExtractionResult({
      key_points: [
        { content: 'a', evidence: [{ content: 'a1' }] },
        { content: 'b', evidence: [{ content: 'b1' }] },
        { content: 'c', evidence: [{ content: 'c1' }] },
      ],
    })).toEqual({ key_points: [
      { content: 'a', evidence: [{ content: 'a1' }] },
      { content: 'b', evidence: [{ content: 'b1' }] },
      { content: 'c', evidence: [{ content: 'c1' }] },
    ] });

    expect(() => validateKeyPointExtractionResult({
      key_points: [
        { content: 'a', evidence: [{ content: 'a1' }] },
        { content: 'b', evidence: [{ content: 'b1' }] },
        { content: 'c', evidence: [{ content: 'c1' }], note: 'do not allow' },
      ],
    })).toThrow(JudgeValidationError);
  });

  it('rejects extraction outputs outside the three-to-five range', () => {
    expect(() => validateKeyPointExtractionResult({ key_points: [{ content: 'a' }, { content: 'b' }] }))
      .toThrow(/SCHEMA_INVALID/);
    expect(() => validateKeyPointExtractionResult({
      key_points: Array.from({ length: 6 }, (_, index) => ({ content: String(index) })),
    })).toThrow(/SCHEMA_INVALID/);
  });

  it('rejects markdown-wrapped JSON instead of repairing it', () => {
    expect(() => validateQuestionResult(`\`\`\`json\n{"verdict":"YES","fully_covered_key_point_ids":[]}\n\`\`\``, [id1]))
      .toThrow(/INVALID_JSON/);
  });

  it('rejects duplicate and unknown key-point IDs', () => {
    expect(() => validateQuestionResult({ verdict: 'YES', fully_covered_key_point_ids: [id1, id1] }, [id1, id2]))
      .toThrow(/SCHEMA_INVALID/);
    expect(() => validateQuestionResult({ verdict: 'YES', fully_covered_key_point_ids: [id2] }, [id1]))
      .toThrow(/UNKNOWN_KEY_POINT_ID/);
  });

  it('validates Evidence IDs separately from legacy key-point coverage', () => {
    expect(validateEvidenceQuestionResult({ verdict: 'NO', established_evidence_ids: [id1] }, [id1, id2]))
      .toEqual({ verdict: 'NO', established_evidence_ids: [id1] });
    expect(() => validateEvidenceQuestionResult({ verdict: 'YES', established_evidence_ids: [id2] }, [id1]))
      .toThrow(/UNKNOWN_EVIDENCE_ID/);
  });

  it('validates final-answer IDs against the supplied allowlist', () => {
    expect(validateFinalAnswerResult({ covered_key_point_ids: [id1, id2] }, [id1, id2]))
      .toEqual({ covered_key_point_ids: [id1, id2] });
    expect(() => validateFinalAnswerResult({ covered_key_point_ids: ['not-a-uuid'] }, [id1]))
      .toThrow(/SCHEMA_INVALID/);
  });
});
