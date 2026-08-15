import { describe, expect, it, vi } from 'vitest';
import type { QuestionJudgeInput } from '@turtle-soup/contracts';
import { OpenAIResponsesSemanticJudge } from './openai-responses-semantic-judge.js';

const pointId = '00000000-0000-4000-8000-000000000001';
const questionInput: QuestionJudgeInput = {
  puzzle_surface: 'surface',
  full_solution: 'solution',
  key_points: [{ id: pointId, content: 'point' }],
  current_message: 'question',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('OpenAI Responses production semantic judge', () => {
  it('routes all three skills through strict JSON schema with Luna medium', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { text: { format: { name: string; schema: Record<string, unknown> } } };
      const output = body.text.format.name === 'key_point_extraction'
        ? { key_points: [{ content: 'one' }, { content: 'two' }, { content: 'three' }] }
        : body.text.format.name === 'question_judge'
          ? { verdict: 'YES', fully_covered_key_point_ids: [pointId] }
          : { covered_key_point_ids: [pointId] };
      return response({
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 11, output_tokens: 7 },
      });
    });
    const judge = new OpenAIResponsesSemanticJudge({
      apiBaseUrl: 'https://api.openai.test/v1',
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'medium',
      timeoutMs: 1_000,
      fetchImpl,
    });

    await expect(judge.extractKeyPoints({ puzzle_surface: 'surface', full_solution: 'solution' })).resolves.toEqual({
      key_points: [{ content: 'one' }, { content: 'two' }, { content: 'three' }],
    });
    await expect(judge.judgeQuestion(questionInput)).resolves.toEqual({
      verdict: 'YES',
      fully_covered_key_point_ids: [pointId],
    });
    await expect(judge.judgeFinalAnswer({ key_points: [{ id: pointId, content: 'point' }], final_answer: 'answer' })).resolves.toEqual({
      covered_key_point_ids: [pointId],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const call of fetchImpl.mock.calls) {
      const body = JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
      expect(body.model).toBe('gpt-5.6-luna');
      expect(body.reasoning).toEqual({ effort: 'medium' });
      expect(body.text).toMatchObject({ format: { type: 'json_schema', strict: true } });
    }
  });

  it('maps non-success responses to a safe transport error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ error: { message: 'provider secret' } }, 401));
    const judge = new OpenAIResponsesSemanticJudge({
      apiBaseUrl: 'https://api.openai.test/v1',
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'medium',
      timeoutMs: 1_000,
      fetchImpl,
    });
    await expect(judge.judgeQuestion(questionInput)).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
  });
});
