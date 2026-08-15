import type { JudgeErrorCode, SemanticJudge } from '@turtle-soup/contracts';
import type { Sql } from 'postgres';
import { recordActionRetry, type ClaimedAction } from '../db/queue.js';
import type { WorkerTransaction } from '../db/client.js';
import { JudgeValidationError } from '../skills/validate-result.js';
import { SemanticJudgeRuntimeError } from '../runtime/semantic-judge.js';
import { processQuestion, type ClaimedQuestionAction, type QuestionProcessorDependencies } from './question-processor.js';
import { processFinalAnswer, type ClaimedFinalAnswerAction, type FinalAnswerProcessorDependencies } from './final-answer-processor.js';
import { completeFinalAnswer, type CompleteFinalAnswerInput } from '../db/complete-final-answer.js';
import { processChallenge, type ClaimedChallengeAction, type ChallengeProcessorDependencies } from './challenge-processor.js';
import type { SkillRuntimeMetadata } from '../runtime/create-semantic-judge.js';

type RetryCode = Exclude<JudgeErrorCode, 'LEASE_LOST'>;

export type ActionProcessorDependencies = {
  judge: SemanticJudge;
  workerId: string;
  sql?: Sql;
  transaction?: WorkerTransaction;
  now?: Date;
  processQuestion?: (action: ClaimedQuestionAction, dependencies: QuestionProcessorDependencies) => Promise<void>;
  processFinalAnswer?: (action: ClaimedFinalAnswerAction, dependencies: FinalAnswerProcessorDependencies) => Promise<void>;
  processChallenge?: (action: ClaimedChallengeAction, dependencies: ChallengeProcessorDependencies) => Promise<void>;
  challengeJudgeFactory?: ChallengeProcessorDependencies['judgeFactory'];
  challengeJudgeMetadata?: SkillRuntimeMetadata;
  recordRetry?: (actionId: string, attempt: number, code: RetryCode) => Promise<void>;
  markBlocked?: (actionId: string, code: RetryCode) => Promise<void>;
};

function leaseIsLive(action: ClaimedAction, now: Date): boolean {
  const expiry = new Date(action.leaseExpiresAt).getTime();
  return Number.isFinite(expiry) && expiry > now.getTime();
}

function retryCode(error: unknown): RetryCode | 'LEASE_LOST' | null {
  if (error instanceof SemanticJudgeRuntimeError) return error.code;
  if (error instanceof JudgeValidationError) return error.code;
  if (error instanceof Error && error.message === 'LEASE_LOST') return 'LEASE_LOST';
  return null;
}

async function retryAction(
  action: ClaimedAction,
  code: RetryCode,
  dependencies: ActionProcessorDependencies,
): Promise<void> {
  if (dependencies.recordRetry) {
    await dependencies.recordRetry(action.id, action.attempt, code);
    return;
  }
  await recordActionRetry(action.id, action.attempt, code, {
    transaction: dependencies.transaction,
    now: dependencies.now,
  });
}

export async function processClaimedAction(
  action: ClaimedAction,
  dependencies: ActionProcessorDependencies,
): Promise<void> {
  const now = dependencies.now ?? new Date();
  if (!leaseIsLive(action, now)) return;

  try {
    if (action.actionType === 'NORMAL_MESSAGE') {
      const runQuestion = dependencies.processQuestion ?? processQuestion;
      await runQuestion(action as ClaimedQuestionAction, {
        judge: dependencies.judge,
        workerId: dependencies.workerId,
        sql: dependencies.sql,
        transaction: dependencies.transaction,
        now: dependencies.now,
      });
    } else if (action.actionType === 'FINAL_ANSWER') {
      const runFinalAnswer = dependencies.processFinalAnswer ?? processFinalAnswer;
      await runFinalAnswer(action as ClaimedFinalAnswerAction, {
        judge: dependencies.judge,
        workerId: dependencies.workerId,
        sql: dependencies.sql,
        completeFinalAnswer: dependencies.transaction
          ? (input: CompleteFinalAnswerInput) => completeFinalAnswer(input, { transaction: dependencies.transaction, now: dependencies.now })
          : undefined,
      });
    } else {
      const runChallenge = dependencies.processChallenge ?? processChallenge;
      await runChallenge(action as ClaimedChallengeAction, {
        judge: dependencies.judge,
        judgeFactory: dependencies.challengeJudgeFactory,
        judgeMetadata: dependencies.challengeJudgeMetadata,
        workerId: dependencies.workerId,
        sql: dependencies.sql,
        transaction: dependencies.transaction,
        now: dependencies.now,
      });
    }
  } catch (error) {
    const code = retryCode(error);
    if (!code || code === 'LEASE_LOST') return;
    await retryAction(action, code, dependencies);
  }
}
