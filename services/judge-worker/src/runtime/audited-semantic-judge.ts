import type {
  FinalAnswerJudgeInput,
  FinalAnswerJudgeResult,
  KeyPointExtractionInput,
  KeyPointExtractionResult,
  ProgressSummaryInput,
  ProgressSummaryResult,
  QuestionJudgeInput,
  QuestionJudgeResult,
  SemanticJudge,
} from '@turtle-soup/contracts';
import type { JudgeAttemptParent, JudgeAttemptRecord } from '../db/judge-attempts.js';
import type { HarnessSkill } from './semantic-judge.js';
import type { JudgeRuntime } from './create-semantic-judge.js';
import { EVIDENCE_QUESTION_JUDGE_PROMPT_VERSION } from '../skills/question-judge.js';

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
      await record(recorder, runtime, parent, skill, input, performance.now() - startedAt, true, null);
      return result;
    } catch (error) {
      await record(recorder, runtime, parent, skill, input, performance.now() - startedAt, false, errorCode(error));
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
    summarizeProgress: (input: ProgressSummaryInput): Promise<ProgressSummaryResult> =>
      call('progress-summary', input, (value) => runtime.judge.summarizeProgress(value)),
  };
}

async function record(
  recorder: JudgeAttemptRecorder,
  runtime: JudgeRuntime,
  parent: JudgeAttemptParent,
  skill: HarnessSkill,
  input: unknown,
  latencyMs: number,
  resultValid: boolean,
  error: string | null,
): Promise<void> {
  try {
    const evidenceQuestion = skill === 'question-judge'
      && typeof input === 'object'
      && input !== null
      && 'key_points' in input
      && Array.isArray(input.key_points)
      && input.key_points.some((point) => typeof point === 'object' && point !== null && 'evidence' in point);
    const metadata = evidenceQuestion
      ? {
        ...runtime.metadata[skill],
        skillVersion: EVIDENCE_QUESTION_JUDGE_PROMPT_VERSION,
        promptVersion: EVIDENCE_QUESTION_JUDGE_PROMPT_VERSION,
        schemaVersion: 'judge-schema-v2' as const,
      }
      : runtime.metadata[skill];
    await recorder({
      parent,
      skill,
      ...metadata,
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
