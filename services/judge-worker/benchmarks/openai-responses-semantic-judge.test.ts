import { describe, expect, it, vi } from 'vitest';
import { SemanticJudgeRuntimeError } from '../src/runtime/semantic-judge.js';
import { JudgeValidationError } from '../src/skills/validate-result.js';
import { OpenAIResponsesSemanticJudge } from './openai-responses-semantic-judge.js';

const input = {
  puzzle_surface: 'surface',
  full_solution: 'solution',
  key_points: [{ id: '00000000-0000-4000-8000-000000000001', content: 'point' }],
  current_message: 'question',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function judge(fetchImpl: typeof fetch, reasoningEffort: 'none' | 'medium' = 'none') {
  return new OpenAIResponsesSemanticJudge({
    apiBaseUrl: 'https://api.openai.test/v1/',
    apiKey: 'test-secret',
    model: 'gpt-5.6-luna',
    reasoningEffort,
    timeoutMs: 1_000,
    fetchImpl,
  });
}

describe('OpenAI Responses semantic judge adapter', () => {
  it.each(['none', 'medium'] as const)('sends native reasoning effort %s and strict schema', async (reasoningEffort) => {
    let request: RequestInit | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      request = init;
      return response({
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ verdict: 'YES', fully_covered_key_point_ids: [input.key_points[0].id] }) }] }],
        usage: { input_tokens: 31, output_tokens: 7 },
      });
    });

    const result = await judge(fetchImpl, reasoningEffort).judgeQuestion(input);
    const body = JSON.parse(String(request?.body));
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.reasoning).toEqual({ effort: reasoningEffort });
    expect(body.text.format.type).toBe('json_schema');
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema.required).toEqual(['verdict', 'fully_covered_key_point_ids']);
    expect(body.text.format.schema.properties.fully_covered_key_point_ids.uniqueItems).toBeUndefined();
    expect(body.input).toContain('UNTRUSTED_DATA');
    expect(result.result).toEqual({ verdict: 'YES', fully_covered_key_point_ids: [input.key_points[0].id] });
    expect(result.inputTokens).toBe(31);
    expect(result.outputTokens).toBe(7);
    expect(result.costUsd).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith('https://api.openai.test/v1/responses', expect.objectContaining({ method: 'POST' }));
  });

  it('uses the shared validator for malformed JSON and invalid verdicts', async () => {
    const invalidJson = vi.fn<typeof fetch>(async () => response({ output_text: '{not-json' }));
    await expect(judge(invalidJson).judgeQuestion(input)).rejects.toMatchObject({
      name: 'JudgeValidationError',
      code: 'INVALID_JSON',
    } satisfies Partial<JudgeValidationError>);

    const invalidSchema = vi.fn<typeof fetch>(async () => response({ output_text: JSON.stringify({ verdict: 'MAYBE', fully_covered_key_point_ids: [] }) }));
    await expect(judge(invalidSchema).judgeQuestion(input)).rejects.toMatchObject({
      name: 'JudgeValidationError',
      code: 'SCHEMA_INVALID',
    } satisfies Partial<JudgeValidationError>);
  });

  it('maps non-success responses without retrying or exposing the response body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ error: { message: 'secret provider detail' } }, 401));
    await expect(judge(fetchImpl).judgeQuestion(input)).rejects.toMatchObject({
      name: 'SemanticJudgeRuntimeError',
      code: 'TRANSPORT_ERROR',
    } satisfies Partial<SemanticJudgeRuntimeError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps an aborted request to TIMEOUT', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      await new Promise<void>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
      throw new Error('unreachable');
    });
    const timeoutJudge = new OpenAIResponsesSemanticJudge({
      apiBaseUrl: 'https://api.openai.test/v1',
      apiKey: 'test-secret',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'none',
      timeoutMs: 1,
      fetchImpl,
    });
    await expect(timeoutJudge.judgeQuestion(input)).rejects.toMatchObject({
      name: 'SemanticJudgeRuntimeError',
      code: 'TIMEOUT',
    } satisfies Partial<SemanticJudgeRuntimeError>);
  });
});
