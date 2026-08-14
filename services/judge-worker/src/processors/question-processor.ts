import type { JudgeKeyPoint, QuestionJudgeInput, SemanticJudge } from '@turtle-soup/contracts';
import type { Sql } from 'postgres';
import { getWorkerDb, type WorkerTransaction } from '../db/client.js';
import { completeQuestion } from '../db/complete-question.js';
import type { ClaimedAction } from '../db/queue.js';

export type ClaimedQuestionAction = ClaimedAction & { actionType: 'NORMAL_MESSAGE' };

type ActionInputRow = { messageId: string };
type SecretInputRow = { puzzleSurface: string; fullSolution: string };
type KeyPointRow = { id: string; content: string; ordinal: number };
type MessageInputRow = { content: string };

export type QuestionProcessorDependencies = {
  judge: SemanticJudge;
  workerId: string;
  sql?: Sql;
  transaction?: WorkerTransaction;
  now?: Date;
};

export class QuestionInputNotFoundError extends Error {
  constructor() {
    super('QUESTION_INPUT_NOT_FOUND');
    this.name = 'QuestionInputNotFoundError';
  }
}

async function loadQuestionInput(
  action: ClaimedQuestionAction,
  sql: Sql,
): Promise<QuestionJudgeInput> {
  const actionRows = await sql<ActionInputRow[]>`
    select result_resource_id::text as "messageId"
    from private.game_actions
    where id = ${action.id}
      and game_id = ${action.gameId}
      and action_type = 'NORMAL_MESSAGE'
  `;
  const messageId = actionRows[0]?.messageId;
  if (!messageId) throw new QuestionInputNotFoundError();

  const [secrets, keyPoints, messages] = await Promise.all([
    sql<SecretInputRow[]>`
      select puzzle_surface as "puzzleSurface", full_solution as "fullSolution"
      from private.game_secrets
      where game_id = ${action.gameId}
      order by input_version desc
      limit 1
    `,
    sql<KeyPointRow[]>`
      select id, content, ordinal
      from private.key_points
      where game_id = ${action.gameId}
      order by ordinal asc
    `,
    sql<MessageInputRow[]>`
      select content
      from api.messages
      where id = ${messageId}
        and game_id = ${action.gameId}
        and player_id = ${action.playerId}
      limit 1
    `,
  ]);
  const secret = secrets[0];
  const message = messages[0];
  if (!secret || !message || keyPoints.length < 3) throw new QuestionInputNotFoundError();

  const input: QuestionJudgeInput = {
    puzzle_surface: secret.puzzleSurface,
    full_solution: secret.fullSolution,
    key_points: keyPoints.map(({ id, content }) => ({ id, content } satisfies JudgeKeyPoint)),
    current_message: message.content,
  };
  return input;
}

export async function processQuestion(
  action: ClaimedQuestionAction,
  dependencies: QuestionProcessorDependencies,
): Promise<void> {
  if (action.actionType !== 'NORMAL_MESSAGE') throw new Error('QUESTION_ACTION_REQUIRED');
  const sql = dependencies.sql ?? getWorkerDb();
  const input = await loadQuestionInput(action, sql);
  const result = await dependencies.judge.judgeQuestion(input);
  await completeQuestion({
    actionId: action.id,
    workerId: dependencies.workerId,
    verdict: result.verdict,
    fullyCoveredKeyPointIds: result.fully_covered_key_point_ids,
  }, {
    transaction: dependencies.transaction,
    now: dependencies.now,
  });
}
