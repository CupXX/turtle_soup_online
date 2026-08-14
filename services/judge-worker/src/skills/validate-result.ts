import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import type {
  FinalAnswerJudgeResult,
  KeyPointExtractionResult,
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
        required: ['content'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
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

export class JudgeValidationError extends Error {
  constructor(
    public readonly code: 'INVALID_JSON' | 'SCHEMA_INVALID' | 'UNKNOWN_KEY_POINT_ID',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'JudgeValidationError';
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const extractionValidator = ajv.compile(KEY_POINT_EXTRACTION_SCHEMA);
const questionValidator = ajv.compile(QUESTION_JUDGE_SCHEMA);
const finalAnswerValidator = ajv.compile(FINAL_ANSWER_JUDGE_SCHEMA);

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
): QuestionJudgeResult {
  const result = validate<QuestionJudgeResult>(value, questionValidator);
  assertAllowedIds(result.fully_covered_key_point_ids, allowedKeyPointIds);
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
