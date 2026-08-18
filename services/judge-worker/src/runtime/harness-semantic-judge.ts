import type {
  FinalAnswerJudgeInput,
  FinalAnswerJudgeResult,
  KeyPointExtractionInput,
  KeyPointExtractionResult,
  ProgressSummaryInput,
  ProgressSummaryResult,
  QuestionJudgeInput,
  QuestionJudgeResult,
} from '@turtle-soup/contracts';
import { buildFinalAnswerJudgePrompt } from '../skills/final-answer-judge.js';
import { buildKeyPointExtractionPrompt } from '../skills/key-point-extraction.js';
import { buildQuestionJudgePrompt } from '../skills/question-judge.js';
import { buildProgressSummaryPrompt } from '../skills/progress-summary.js';
import {
  EVIDENCE_QUESTION_JUDGE_SCHEMA,
  FINAL_ANSWER_JUDGE_SCHEMA,
  JudgeValidationError,
  KEY_POINT_EXTRACTION_SCHEMA,
  PROGRESS_SUMMARY_SCHEMA,
  QUESTION_JUDGE_SCHEMA,
  validateFinalAnswerResult,
  validateEvidenceQuestionResult,
  validateKeyPointExtractionResult,
  validateProgressSummaryResult,
  validateQuestionResult,
} from '../skills/validate-result.js';
import {
  SemanticJudgeRuntimeError,
  type HarnessInvoker,
  type HarnessSkill,
} from './semantic-judge.js';

export class HarnessSemanticJudge {
  constructor(
    private readonly invoke: HarnessInvoker,
    private readonly timeoutMs = 30_000,
  ) {}

  extractKeyPoints(input: KeyPointExtractionInput): Promise<KeyPointExtractionResult> {
    return this.call('key-point-extraction', buildKeyPointExtractionPrompt(input), KEY_POINT_EXTRACTION_SCHEMA, (raw) => validateKeyPointExtractionResult(raw));
  }

  judgeQuestion(input: QuestionJudgeInput): Promise<QuestionJudgeResult> {
    const evidenceIds = input.key_points.flatMap(({ evidence }) => evidence?.map(({ id }) => id) ?? []);
    if (evidenceIds.length > 0) {
      return this.call(
        'question-judge',
        buildQuestionJudgePrompt(input),
        EVIDENCE_QUESTION_JUDGE_SCHEMA,
        (raw) => validateEvidenceQuestionResult(raw, evidenceIds),
      );
    }
    return this.call(
      'question-judge',
      buildQuestionJudgePrompt(input),
      QUESTION_JUDGE_SCHEMA,
      (raw) => validateQuestionResult(raw, input.key_points.map((point) => point.id)),
    );
  }

  judgeFinalAnswer(input: FinalAnswerJudgeInput): Promise<FinalAnswerJudgeResult> {
    return this.call(
      'final-answer-judge',
      buildFinalAnswerJudgePrompt(input),
      FINAL_ANSWER_JUDGE_SCHEMA,
      (raw) => validateFinalAnswerResult(raw, input.key_points.map((point) => point.id)),
    );
  }

  summarizeProgress(input: ProgressSummaryInput): Promise<ProgressSummaryResult> {
    return this.call(
      'progress-summary',
      buildProgressSummaryPrompt(input),
      PROGRESS_SUMMARY_SCHEMA,
      (raw) => validateProgressSummaryResult(raw),
    );
  }

  private async call<T>(
    skill: HarnessSkill,
    prompt: string,
    schema: Record<string, unknown>,
    validate: (raw: unknown) => T,
  ): Promise<T> {
    let raw: unknown;
    try {
      raw = await this.withTimeout(this.invoke({ skill, prompt, schema, timeoutMs: this.timeoutMs }));
    } catch (error) {
      if (error instanceof JudgeValidationError) throw error;
      if (error instanceof SemanticJudgeRuntimeError) throw error;
      throw new SemanticJudgeRuntimeError('TRANSPORT_ERROR', error instanceof Error ? error.message : 'provider request failed');
    }
    return validate(raw);
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SemanticJudgeRuntimeError('TIMEOUT', 'provider request timed out')), this.timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
