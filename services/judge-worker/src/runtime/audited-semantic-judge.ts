import type {
  FinalAnswerJudgeInput,
  FinalAnswerJudgeResult,
  KeyPointExtractionInput,
  KeyPointExtractionResult,
  QuestionJudgeInput,
  QuestionJudgeResult,
  SemanticJudge,
} from '@turtle-soup/contracts';
import type { JudgeAttemptParent, JudgeAttemptRecord } from '../db/judge-attempts.js';
import type { HarnessSkill } from './semantic-judge.js';
import type { JudgeRuntime } from './create-semantic-judge.js';

export type JudgeAttemptRecorder = (record: JudgeAttemptRecord) => Promise<void>;

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  if (error instanceof Error && error.name) return error.name;
  return 'UNKNOWN_ERROR';
}

export function createAuditedSemanticJudge(
  runtime: JudgeRuntime,
  parent: JudgeAttemptParent,
  recorder: JudgeAttemptRecorder,
): SemanticJudge {
  const call = async <Input, Result>(
    skill: HarnessSkill,
    input: Input,
    invoke: (input: Input) => Promise<Result>,
  ): Promise<Result> => {
    const startedAt = performance.now();
    try {
      const result = await invoke(input);
      await record(recorder, runtime, parent, skill, performance.now() - startedAt, true, null);
      return result;
    } catch (error) {
      await record(recorder, runtime, parent, skill, performance.now() - startedAt, false, errorCode(error));
      throw error;
    }
  };

  return {
    extractKeyPoints: (input: KeyPointExtractionInput): Promise<KeyPointExtractionResult> =>
      call('key-point-extraction', input, (value) => runtime.judge.extractKeyPoints(value)),
    judgeQuestion: (input: QuestionJudgeInput): Promise<QuestionJudgeResult> =>
      call('question-judge', input, (value) => runtime.judge.judgeQuestion(value)),
    judgeFinalAnswer: (input: FinalAnswerJudgeInput): Promise<FinalAnswerJudgeResult> =>
      call('final-answer-judge', input, (value) => runtime.judge.judgeFinalAnswer(value)),
  };
}

async function record(
  recorder: JudgeAttemptRecorder,
  runtime: JudgeRuntime,
  parent: JudgeAttemptParent,
  skill: HarnessSkill,
  latencyMs: number,
  resultValid: boolean,
  error: string | null,
): Promise<void> {
  try {
    await recorder({
      parent,
      skill,
      ...runtime.metadata[skill],
      latencyMs: Math.max(0, Math.round(latencyMs)),
      inputTokens: null,
      outputTokens: null,
      resultValid,
      errorCode: error,
    });
  } catch {
    // Auditing is deliberately best effort; it must never alter game behavior.
  }
}
