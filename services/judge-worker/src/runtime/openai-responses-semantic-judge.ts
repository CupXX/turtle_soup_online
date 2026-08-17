import type {
  FinalAnswerJudgeInput,
  FinalAnswerJudgeResult,
  KeyPointExtractionInput,
  KeyPointExtractionResult,
  QuestionJudgeInput,
  QuestionJudgeResult,
} from '@turtle-soup/contracts';
import { buildFinalAnswerJudgePrompt } from '../skills/final-answer-judge.js';
import { buildKeyPointExtractionPrompt } from '../skills/key-point-extraction.js';
import { buildQuestionJudgePrompt } from '../skills/question-judge.js';
import {
  EVIDENCE_QUESTION_JUDGE_SCHEMA,
  FINAL_ANSWER_JUDGE_SCHEMA,
  KEY_POINT_EXTRACTION_SCHEMA,
  QUESTION_JUDGE_SCHEMA,
  validateFinalAnswerResult,
  validateEvidenceQuestionResult,
  validateKeyPointExtractionResult,
  validateQuestionResult,
} from '../skills/validate-result.js';
import type { ReasoningEffort } from '../config.js';
import { SemanticJudgeRuntimeError } from './semantic-judge.js';

type JsonRecord = Record<string, unknown>;

export type OpenAIResponsesSemanticJudgeOptions = {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function responseText(value: unknown): string {
  if (!isRecord(value)) throw new Error('response envelope is not an object');
  if (typeof value.output_text === 'string') return value.output_text;
  if (!Array.isArray(value.output)) throw new Error('response has no output text');
  for (const item of value.output) {
    if (!isRecord(item)) continue;
    if (item.type === 'output_text' && typeof item.text === 'string') return item.text;
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('response has no output text');
}

function openAIStructuredSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => openAIStructuredSchema(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'uniqueItems')
    .map(([key, item]) => [key, openAIStructuredSchema(item)]));
}

function reasoningEffort(value: ReasoningEffort): Exclude<ReasoningEffort, 'off' | 'max'> | 'none' {
  if (value === 'off') return 'none';
  if (value === 'max') return 'high';
  return value;
}

export class OpenAIResponsesSemanticJudge {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIResponsesSemanticJudgeOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  extractKeyPoints(input: KeyPointExtractionInput): Promise<KeyPointExtractionResult> {
    return this.call(
      'key_point_extraction',
      buildKeyPointExtractionPrompt(input),
      KEY_POINT_EXTRACTION_SCHEMA,
      (raw) => validateKeyPointExtractionResult(raw),
    );
  }

  judgeQuestion(input: QuestionJudgeInput): Promise<QuestionJudgeResult> {
    const evidenceIds = input.key_points.flatMap(({ evidence }) => evidence?.map(({ id }) => id) ?? []);
    if (evidenceIds.length > 0) {
      return this.call(
        'question_judge_evidence',
        buildQuestionJudgePrompt(input),
        EVIDENCE_QUESTION_JUDGE_SCHEMA,
        (raw) => validateEvidenceQuestionResult(raw, evidenceIds),
      );
    }
    return this.call(
      'question_judge',
      buildQuestionJudgePrompt(input),
      QUESTION_JUDGE_SCHEMA,
      (raw) => validateQuestionResult(raw, input.key_points.map(({ id }) => id)),
    );
  }

  judgeFinalAnswer(input: FinalAnswerJudgeInput): Promise<FinalAnswerJudgeResult> {
    return this.call(
      'final_answer_judge',
      buildFinalAnswerJudgePrompt(input),
      FINAL_ANSWER_JUDGE_SCHEMA,
      (raw) => validateFinalAnswerResult(raw, input.key_points.map(({ id }) => id)),
    );
  }

  private async call<T>(
    schemaName: string,
    prompt: string,
    schema: Record<string, unknown>,
    validate: (raw: unknown) => T,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, this.options.timeoutMs));
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.apiBaseUrl.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          input: prompt,
          reasoning: { effort: reasoningEffort(this.options.reasoningEffort) },
          text: {
            format: {
              type: 'json_schema',
              name: schemaName,
              strict: true,
              schema: openAIStructuredSchema(schema),
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted) throw new SemanticJudgeRuntimeError('TIMEOUT', 'OpenAI Responses invocation timed out');
      throw new SemanticJudgeRuntimeError('TRANSPORT_ERROR', error instanceof Error ? error.message : 'OpenAI Responses request failed');
    }
    clearTimeout(timer);
    if (!response.ok) throw new SemanticJudgeRuntimeError('TRANSPORT_ERROR', `OpenAI Responses returned HTTP ${response.status}`);

    let envelope: unknown;
    try {
      envelope = JSON.parse(await response.text());
    } catch {
      throw new SemanticJudgeRuntimeError('TRANSPORT_ERROR', 'OpenAI Responses returned an invalid envelope');
    }
    let output: string;
    try {
      output = responseText(envelope);
    } catch {
      throw new SemanticJudgeRuntimeError('TRANSPORT_ERROR', 'OpenAI Responses returned no output text');
    }
    return validate(output);
  }
}
