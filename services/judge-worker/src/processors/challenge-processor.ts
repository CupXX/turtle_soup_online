import type { JudgeKeyPoint, QuestionJudgeInput, QuestionJudgeResult, SemanticJudge } from '@turtle-soup/contracts';
import { resolveChallengeVotes, type ChallengeVote } from '@turtle-soup/game-core';
import type { Sql } from 'postgres';
import { getWorkerDb, type WorkerTransaction } from '../db/client.js';
import { recordChallengeJudgment, type ChallengeJudgmentRecord } from '../db/challenge-judgments.js';
import { completeChallenge, type CompleteChallengeFreshJudgment } from '../db/complete-challenge.js';
import type { SkillRuntimeMetadata } from '../runtime/create-semantic-judge.js';
import { JudgeValidationError, validateQuestionResult } from '../skills/validate-result.js';
import type { ClaimedAction } from '../db/queue.js';

export type ClaimedChallengeAction = ClaimedAction & { actionType: 'CHALLENGE' };

type ActionInputRow = { challengeId: string };
type SecretInputRow = { puzzleSurface: string; fullSolution: string };
type KeyPointRow = { id: string; content: string; ordinal: number };
type MessageInputRow = { content: string };
type OriginalJudgmentRow = {
  originalVerdict: QuestionJudgeResult['verdict'];
  originalCoveredKeyPointIds: string[];
  promptVersion: string;
  schemaVersion: string;
};
type ExistingFreshJudgmentRow = {
  slot: number;
  verdict: QuestionJudgeResult['verdict'] | null;
  coveredKeyPointIds: string[];
  valid: boolean;
};
type ChallengeInput = {
  challengeId: string;
  question: QuestionJudgeInput;
  original: ChallengeVote;
  keyPointIds: string[];
  existing: ExistingFreshJudgmentRow[];
};

export type ChallengeProcessorDependencies = {
  judge: SemanticJudge;
  judgeFactory?: (slot: number) => SemanticJudge;
  judgeMetadata?: SkillRuntimeMetadata;
  workerId: string;
  sql?: Sql;
  transaction?: WorkerTransaction;
  now?: Date;
  persistJudgment?: (record: ChallengeJudgmentRecord) => Promise<void>;
  complete?: (input: {
    actionId: string;
    workerId: string;
    challengeId: string;
    freshJudgments: CompleteChallengeFreshJudgment[];
  }) => Promise<void>;
};

export class ChallengeInputNotFoundError extends Error {
  constructor() {
    super('CHALLENGE_INPUT_NOT_FOUND');
    this.name = 'ChallengeInputNotFoundError';
  }
}

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed.slice(1, -1).split(',').map((item) => item.replace(/^"|"$/g, '')).filter(Boolean);
  }
  return [];
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  if (error instanceof Error && error.name) return error.name;
  return 'UNKNOWN_ERROR';
}

function defaultMetadata(): SkillRuntimeMetadata {
  return {
    provider: 'unknown',
    model: 'unknown',
    reasoningEffort: 'off',
    skillVersion: 'question-judge-v6',
    promptVersion: 'question-judge-v6',
    schemaVersion: 'judge-schema-v1',
  };
}

export async function loadChallengeInput(action: ClaimedChallengeAction, sql: Sql): Promise<ChallengeInput> {
  const actionRows = await sql<ActionInputRow[]>`
    select result_resource_id::text as "challengeId"
    from private.game_actions
    where id = ${action.id}
      and game_id = ${action.gameId}
      and action_type = 'CHALLENGE'
  `;
  const challengeId = actionRows[0]?.challengeId;
  if (!challengeId) throw new ChallengeInputNotFoundError();

  const [secrets, keyPoints, messages, judgments, fresh] = await Promise.all([
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
      select messages.content
      from private.message_challenges challenges
      join api.messages messages on messages.id = challenges.message_id
      where challenges.id = ${challengeId}
        and challenges.game_id = ${action.gameId}
      limit 1
    `,
    sql<OriginalJudgmentRow[]>`
      select
        original_verdict as "originalVerdict",
        original_covered_key_point_ids as "originalCoveredKeyPointIds",
        prompt_version as "promptVersion",
        schema_version as "schemaVersion"
      from private.question_judgments
      where message_id = (
        select message_id from private.message_challenges where id = ${challengeId}
      )
        and game_id = ${action.gameId}
      limit 1
    `,
    sql<ExistingFreshJudgmentRow[]>`
      select
        slot,
        verdict,
        covered_key_point_ids as "coveredKeyPointIds",
        valid
      from private.challenge_judgments
      where challenge_id = ${challengeId}
      order by slot asc
    `,
  ]);
  const secret = secrets[0];
  const message = messages[0];
  const original = judgments[0];
  if (!secret || !message || !original || keyPoints.length < 3) throw new ChallengeInputNotFoundError();
  const keyPointIds = keyPoints.map(({ id }) => id);
  return {
    challengeId,
    question: {
      puzzle_surface: secret.puzzleSurface,
      full_solution: secret.fullSolution,
      key_points: keyPoints.map(({ id, content }) => ({ id, content } satisfies JudgeKeyPoint)),
      current_message: message.content,
    },
    original: {
      valid: true,
      verdict: original.originalVerdict,
      coveredKeyPointIds: arrayValue(original.originalCoveredKeyPointIds),
    },
    keyPointIds,
    existing: fresh.map((row) => ({ ...row, coveredKeyPointIds: arrayValue(row.coveredKeyPointIds) })),
  };
}

function retryableInsufficientJudgments(): JudgeValidationError {
  return new JudgeValidationError('SCHEMA_INVALID', 'challenge requires four valid fresh judgments');
}

export async function processChallenge(
  action: ClaimedChallengeAction,
  dependencies: ChallengeProcessorDependencies,
): Promise<void> {
  if (action.actionType !== 'CHALLENGE') throw new Error('CHALLENGE_ACTION_REQUIRED');
  const sql = dependencies.sql ?? getWorkerDb();
  const input = await loadChallengeInput(action, sql);
  const metadata = dependencies.judgeMetadata ?? defaultMetadata();
  const existing = new Map(input.existing.map((row) => [row.slot, row]));
  const freshJudgments: CompleteChallengeFreshJudgment[] = [];

  for (let slot = 1; slot <= 4; slot += 1) {
    const previous = existing.get(slot);
    if (previous?.valid && previous.verdict) {
      freshJudgments.push({ slot, verdict: previous.verdict, coveredKeyPointIds: previous.coveredKeyPointIds });
      continue;
    }

    const startedAt = performance.now();
    const selectedJudge = dependencies.judgeFactory?.(slot) ?? dependencies.judge;
    try {
      const result = validateQuestionResult(await selectedJudge.judgeQuestion(input.question), input.keyPointIds);
      const record: ChallengeJudgmentRecord = {
        challengeId: input.challengeId,
        slot,
        metadata,
        verdict: result.verdict,
        coveredKeyPointIds: result.fully_covered_key_point_ids,
        valid: true,
        errorCode: null,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
      await (dependencies.persistJudgment ?? ((value: ChallengeJudgmentRecord) => recordChallengeJudgment(value))) (record);
      freshJudgments.push({ slot, verdict: result.verdict, coveredKeyPointIds: result.fully_covered_key_point_ids });
    } catch (error) {
      const invalidRecord: ChallengeJudgmentRecord = {
        challengeId: input.challengeId,
        slot,
        metadata,
        verdict: null,
        coveredKeyPointIds: [],
        valid: false,
        errorCode: errorCode(error),
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
      await (dependencies.persistJudgment ?? ((value: ChallengeJudgmentRecord) => recordChallengeJudgment(value))) (invalidRecord);
    }
  }

  if (freshJudgments.length < 4) throw retryableInsufficientJudgments();

  // Exercise the same pure resolver before the transaction so malformed fake
  // results fail before any public verdict can be changed.
  resolveChallengeVotes([
    input.original,
    ...freshJudgments.map(({ verdict, coveredKeyPointIds }) => ({ valid: true, verdict, coveredKeyPointIds })),
  ], input.keyPointIds);

  const complete = dependencies.complete ?? ((value: {
    actionId: string;
    workerId: string;
    challengeId: string;
    freshJudgments: CompleteChallengeFreshJudgment[];
  }) => completeChallenge(value, { transaction: dependencies.transaction, now: dependencies.now }));
  await complete({ actionId: action.id, workerId: dependencies.workerId, challengeId: input.challengeId, freshJudgments });
}
