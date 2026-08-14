import type { FinalAnswerJudgeInput, JudgeKeyPoint, SemanticJudge } from '@turtle-soup/contracts';
import type { Sql } from 'postgres';
import { getWorkerDb } from '../db/client.js';
import { completeFinalAnswer, type CompleteFinalAnswerInput } from '../db/complete-final-answer.js';
import type { ClaimedAction } from '../db/queue.js';

export type ClaimedFinalAnswerAction = ClaimedAction & { actionType: 'FINAL_ANSWER' };

export type FinalAnswerProcessorDependencies = {
  judge: SemanticJudge;
  workerId: string;
  sql?: Sql;
  completeFinalAnswer?: (input: CompleteFinalAnswerInput) => Promise<void>;
};

type SubmissionInputRow = { answer: string; gameId: string; playerId: string };
type KeyPointRow = { id: string; content: string; ordinal: number };

export class FinalAnswerInputNotFoundError extends Error {
  constructor() {
    super('FINAL_ANSWER_INPUT_NOT_FOUND');
    this.name = 'FinalAnswerInputNotFoundError';
  }
}

async function loadFinalAnswerInput(action: ClaimedFinalAnswerAction, sql: Sql): Promise<FinalAnswerJudgeInput> {
  const submissions = await sql<SubmissionInputRow[]>`
    select answer, game_id as "gameId", player_id as "playerId"
    from private.final_answer_submissions
    where id = ${action.id}
      and action_id = ${action.id}
      and game_id = ${action.gameId}
      and player_id = ${action.playerId}
      and status = 'PENDING'
    limit 1
  `;
  const keyPoints = await sql<KeyPointRow[]>`
    select id, content, ordinal
    from private.key_points
    where game_id = ${action.gameId}
    order by ordinal asc
  `;
  const submission = submissions[0];
  if (!submission || keyPoints.length < 3) throw new FinalAnswerInputNotFoundError();

  return {
    key_points: keyPoints.map(({ id, content }) => ({ id, content } satisfies JudgeKeyPoint)),
    final_answer: submission.answer,
  };
}

export async function processFinalAnswer(
  action: ClaimedFinalAnswerAction,
  dependencies: FinalAnswerProcessorDependencies,
): Promise<void> {
  if (action.actionType !== 'FINAL_ANSWER') throw new Error('FINAL_ANSWER_ACTION_REQUIRED');
  const sql = dependencies.sql ?? getWorkerDb();
  const input = await loadFinalAnswerInput(action, sql);
  const result = await dependencies.judge.judgeFinalAnswer(input);
  const complete = dependencies.completeFinalAnswer ?? ((completion: CompleteFinalAnswerInput) => completeFinalAnswer(completion));
  await complete({
    actionId: action.id,
    workerId: dependencies.workerId,
    coveredKeyPointIds: result.covered_key_point_ids,
  });
}
