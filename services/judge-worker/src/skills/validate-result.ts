import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import type {
  EvidenceQuestionJudgeResult,
  FinalAnswerJudgeResult,
  KeyPointExtractionResult,
  LegacyQuestionJudgeResult,
  ProgressSummaryResult,
  QuestionJudgeResult,
} from '@turtle-soup/contracts';

const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

export const KEY_POINT_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key_points'],
  properties: {
    key_points: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['content', 'evidence'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 2000 },
          evidence: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['content'],
              properties: {
                content: { type: 'string', minLength: 1, maxLength: 2000 },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const EVIDENCE_QUESTION_JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'established_evidence_ids'],
  properties: {
    verdict: { enum: ['YES', 'NO', 'BOTH', 'IRRELEVANT'] },
    established_evidence_ids: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: UUID_PATTERN },
    },
  },
} as const;

export const QUESTION_JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'fully_covered_key_point_ids'],
  properties: {
    verdict: { enum: ['YES', 'NO', 'BOTH', 'IRRELEVANT'] },
    fully_covered_key_point_ids: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: UUID_PATTERN },
    },
  },
} as const;

export const FINAL_ANSWER_JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['covered_key_point_ids'],
  properties: {
    covered_key_point_ids: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: UUID_PATTERN },
    },
  },
} as const;

export const PROGRESS_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['confirmed_facts', 'ruled_out_facts', 'irrelevant_topics'],
  properties: {
    confirmed_facts: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', minLength: 1, maxLength: 120 },
    },
    ruled_out_facts: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', minLength: 1, maxLength: 120 },
    },
    irrelevant_topics: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', minLength: 1, maxLength: 120 },
    },
  },
} as const;

export class JudgeValidationError extends Error {
  constructor(
    public readonly code: 'INVALID_JSON' | 'SCHEMA_INVALID' | 'UNKNOWN_KEY_POINT_ID' | 'UNKNOWN_EVIDENCE_ID',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'JudgeValidationError';
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const extractionValidator = ajv.compile(KEY_POINT_EXTRACTION_SCHEMA);
const questionValidator = ajv.compile(QUESTION_JUDGE_SCHEMA);
const evidenceQuestionValidator = ajv.compile(EVIDENCE_QUESTION_JUDGE_SCHEMA);
const finalAnswerValidator = ajv.compile(FINAL_ANSWER_JUDGE_SCHEMA);
const progressSummaryValidator = ajv.compile(PROGRESS_SUMMARY_SCHEMA);

function parseResult(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new JudgeValidationError('INVALID_JSON', 'provider output is not exactly one JSON value');
  }
}

function validate<T>(value: unknown, validator: ValidateFunction<T>): T {
  const parsed = parseResult(value);
  if (!validator(parsed)) {
    throw new JudgeValidationError('SCHEMA_INVALID', ajv.errorsText(validator.errors));
  }
  return parsed as T;
}

function assertUniqueContents(result: KeyPointExtractionResult): void {
  const normalized = result.key_points.map(({ content }) => content.normalize('NFKC').toLocaleLowerCase('zh-CN'));
  if (new Set(normalized).size !== normalized.length) {
    throw new JudgeValidationError('SCHEMA_INVALID', 'key point contents must be unique');
  }
  for (const point of result.key_points) {
    const evidence = point.evidence.map(({ content }) => content.normalize('NFKC').toLocaleLowerCase('zh-CN'));
    if (new Set(evidence).size !== evidence.length) {
      throw new JudgeValidationError('SCHEMA_INVALID', 'Evidence contents must be unique within a key point');
    }
  }
}

function assertUniqueProgressSummaryContents(result: ProgressSummaryResult): void {
  for (const facts of [result.confirmed_facts, result.ruled_out_facts, result.irrelevant_topics]) {
    const normalized = facts.map((fact) => fact.normalize('NFKC').toLocaleLowerCase('zh-CN'));
    if (new Set(normalized).size !== normalized.length) {
      throw new JudgeValidationError('SCHEMA_INVALID', 'progress summary facts must be unique within each category');
    }
  }
}

function assertAllowedIds(ids: string[], allowedIds: readonly string[]): void {
  const allowed = new Set(allowedIds);
  const unknown = ids.find((id) => !allowed.has(id));
  if (unknown) {
    throw new JudgeValidationError('UNKNOWN_KEY_POINT_ID', `unknown key-point id: ${unknown}`);
  }
}

export function validateKeyPointExtractionResult(value: unknown): KeyPointExtractionResult {
  const result = validate<KeyPointExtractionResult>(value, extractionValidator);
  assertUniqueContents(result);
  return result;
}

export function validateQuestionResult(
  value: unknown,
  allowedKeyPointIds: readonly string[],
): LegacyQuestionJudgeResult {
  const result = validate<LegacyQuestionJudgeResult>(value, questionValidator);
  assertAllowedIds(result.fully_covered_key_point_ids, allowedKeyPointIds);
  return result;
}

export function validateEvidenceQuestionResult(
  value: unknown,
  allowedEvidenceIds: readonly string[],
): EvidenceQuestionJudgeResult {
  const result = validate<EvidenceQuestionJudgeResult>(value, evidenceQuestionValidator);
  const allowed = new Set(allowedEvidenceIds);
  const unknown = result.established_evidence_ids.find((id) => !allowed.has(id));
  if (unknown) throw new JudgeValidationError('UNKNOWN_EVIDENCE_ID', `unknown Evidence id: ${unknown}`);
  return result;
}

export function validateFinalAnswerResult(
  value: unknown,
  allowedKeyPointIds: readonly string[],
): FinalAnswerJudgeResult {
  const result = validate<FinalAnswerJudgeResult>(value, finalAnswerValidator);
  assertAllowedIds(result.covered_key_point_ids, allowedKeyPointIds);
  return result;
}

export function validateProgressSummaryResult(value: unknown): ProgressSummaryResult {
  const result = validate<ProgressSummaryResult>(value, progressSummaryValidator);
  assertUniqueProgressSummaryContents(result);
  return result;
}
