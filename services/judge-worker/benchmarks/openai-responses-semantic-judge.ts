import type { QuestionJudgeInput, QuestionJudgeResult } from '@turtle-soup/contracts';
import { buildQuestionJudgePrompt } from '../src/skills/question-judge.js';
import { QUESTION_JUDGE_SCHEMA, validateQuestionResult } from '../src/skills/validate-result.js';
import { SemanticJudgeRuntimeError } from '../src/runtime/semantic-judge.js';
import type { JudgeResultWithUsage } from './question-judge-regression.js';

export type OpenAIReasoningEffort = 'none' | 'medium';

export type OpenAIResponsesSemanticJudgeOptions = {
  apiBaseUrl: string;
  apiKey: string;
  model: 'gpt-5.6-luna';
  reasoningEffort: OpenAIReasoningEffort;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

type JsonRecord = Record<string, unknown>;

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

function usageNumber(usage: unknown, ...keys: string[]): number | null {
  if (!isRecord(usage)) return null;
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function openAIStructuredSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => openAIStructuredSchema(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'uniqueItems')
    .map(([key, item]) => [key, openAIStructuredSchema(item)]));
}

function parseResponseEnvelope(raw: string): JsonRecord {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) throw new Error('not object');
    return value;
  } catch {
    throw new Error('response envelope is not valid JSON');
  }
}

export class OpenAIResponsesSemanticJudge {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIResponsesSemanticJudgeOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async judgeQuestion(input: QuestionJudgeInput): Promise<JudgeResultWithUsage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, this.options.timeoutMs));
    const requestBody = {
      model: this.options.model,
      input: buildQuestionJudgePrompt(input),
      reasoning: { effort: this.options.reasoningEffort },
      text: {
        format: {
          type: 'json_schema',
          name: 'question_judge',
          strict: true,
          // OpenAI's strict structured-output subset rejects JSON Schema uniqueItems.
          // The shared validator still enforces uniqueness after the response returns.
          schema: openAIStructuredSchema(QUESTION_JUDGE_SCHEMA),
        },
      },
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.apiBaseUrl.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted) throw new SemanticJudgeRuntimeError('TIMEOUT', 'OpenAI Responses invocation timed out');
      throw new SemanticJudgeRuntimeError('TRANSPORT_ERROR', error instanceof Error ? error.message : 'OpenAI Responses request failed');
    }
    clearTimeout(timer);

    if (!response.ok) {
      throw new SemanticJudgeRuntimeError('TRANSPORT_ERROR', `OpenAI Responses returned HTTP ${response.status}`);
    }

    let envelope: JsonRecord;
    try {
      envelope = parseResponseEnvelope(await response.text());
    } catch {
      throw new SemanticJudgeRuntimeError('TRANSPORT_ERROR', 'OpenAI Responses returned an invalid envelope');
    }

    let output: string;
    try {
      output = responseText(envelope);
    } catch {
      throw new SemanticJudgeRuntimeError('TRANSPORT_ERROR', 'OpenAI Responses returned no output text');
    }

    const allowedKeyPointIds = input.key_points.map(({ id }) => id);
    const result: QuestionJudgeResult = validateQuestionResult(output, allowedKeyPointIds);
    const usage = envelope.usage;
    return {
      result,
      inputTokens: usageNumber(usage, 'input_tokens', 'prompt_tokens'),
      outputTokens: usageNumber(usage, 'output_tokens', 'completion_tokens'),
      costUsd: null,
    };
  }
}
