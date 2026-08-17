import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import extractionSchema from '../schemas/key-point-extraction-result.schema.json' with { type: 'json' };
import finalAnswerSchema from '../schemas/final-answer-judge-result.schema.json' with { type: 'json' };
import questionSchema from '../schemas/question-judge-result.schema.json' with { type: 'json' };

describe('canonical judge schemas', () => {
  const ajv = new Ajv({ allErrors: true, strict: true });

  it('accepts a valid question result and rejects invalid verdicts', () => {
    const validateQuestion = ajv.compile(questionSchema);

    expect(validateQuestion({ verdict: 'YES', fully_covered_key_point_ids: [] })).toBe(true);
    expect(validateQuestion({ verdict: 'MAYBE', fully_covered_key_point_ids: [] })).toBe(false);
  });

  it('rejects player-facing explanation fields from final results', () => {
    const validateFinal = ajv.compile(finalAnswerSchema);

    expect(validateFinal({ covered_key_point_ids: [] })).toBe(true);
    expect(validateFinal({ covered_key_point_ids: [], explanation: 'hidden' })).toBe(false);
  });

  it('requires between three and five extraction points', () => {
    const validateExtraction = ajv.compile(extractionSchema);

    expect(validateExtraction({ key_points: [{ content: 'a' }, { content: 'b' }] })).toBe(false);
    expect(
      validateExtraction({
        key_points: [
          { content: 'a', evidence: [{ content: 'a1' }] },
          { content: 'b', evidence: [{ content: 'b1' }] },
          { content: 'c', evidence: [{ content: 'c1' }] },
        ],
      }),
    ).toBe(true);
  });
});
