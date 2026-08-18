import type { JudgeVerdict } from '@turtle-soup/contracts';
import type { Sql, TransactionSql } from 'postgres';
import { withWorkerTransaction, type WorkerTransaction } from './client.js';
import { rebuildEvidenceProgressInTransaction } from './rebuild-evidence-progress.js';
import { ensureProgressSummaryJobForBoundary } from './progress-summary-queue.js';
import { QUESTION_JUDGE_PROMPT_VERSION } from '../skills/question-judge.js';

const QUESTION_JUDGE_SCHEMA_VERSION = 'judge-schema-v1';
const EVIDENCE_QUESTION_JUDGE_SCHEMA_VERSION = 'judge-schema-v2';

export type CompleteQuestionInput = {
  actionId: string;
  workerId: string;
  verdict: JudgeVerdict;
  fullyCoveredKeyPointIds?: string[];
  establishedEvidenceIds?: string[];
};

export type CompleteQuestionDependencies = {
  transaction?: WorkerTransaction;
  now?: Date;
  scheduleProgressSummary?: ProgressSummaryScheduler;
};

export type ProgressSummaryScheduler = (
  sql: TransactionSql,
  gameId: string,
  throughQuestionCount: number,
) => Promise<void>;

type ActionRow = {
  id: string;
  gameId: string;
  playerId: string;
  actionType: string;
  status: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  resultResourceId: string | null;
};

type GameRow = { id: string; status: string };
type MessageRow = { id: string; gameId: string; playerId: string; status: string };

const VERDICTS = new Set<JudgeVerdict>(['YES', 'NO', 'BOTH', 'IRRELEVANT']);

function transactionFor(dependencies: CompleteQuestionDependencies): WorkerTransaction {
  return dependencies.transaction ?? withWorkerTransaction;
}

function progressSummaryScheduler(dependencies: CompleteQuestionDependencies): ProgressSummaryScheduler {
  return dependencies.scheduleProgressSummary ?? ((sql, gameId, throughQuestionCount) => ensureProgressSummaryJobForBoundary(
    sql as unknown as Sql,
    gameId,
    throughQuestionCount,
  ));
}

async function scheduleQuestionBoundary(
  sql: TransactionSql,
  gameId: string,
  scheduleProgressSummary: ProgressSummaryScheduler,
): Promise<void> {
  const counts = await sql<Array<{ count: number | string | bigint }>>`
    select count(*)::int as count
    from api.messages
    where game_id = ${gameId}
      and status = 'JUDGED'
      and verdict is not null
  `;
  const judgedCount = Number(counts[0]?.count ?? 0);
  if (judgedCount >= 10 && judgedCount % 10 === 0) {
    await scheduleProgressSummary(sql, gameId, judgedCount);
  }
}

function activeLease(action: ActionRow, workerId: string, now: Date): boolean {
  if (action.status !== 'PROCESSING' || action.leaseOwner !== workerId || !action.leaseExpiresAt) return false;
  return new Date(action.leaseExpiresAt).getTime() > now.getTime();
}

function uniqueKeyPointIds(ids: string[]): string[] {
  const sorted = [...ids].sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      throw new Error('DUPLICATE_KEY_POINT_ID');
    }
  }
  return sorted;
}

function uniqueEvidenceIds(ids: string[]): string[] {
  const sorted = [...ids].sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) throw new Error('DUPLICATE_EVIDENCE_ID');
  }
  return sorted;
}

export async function completeQuestion(
  input: CompleteQuestionInput,
  dependencies: CompleteQuestionDependencies = {},
): Promise<void> {
  if (!VERDICTS.has(input.verdict)) throw new Error('INVALID_VERDICT');
  if (input.fullyCoveredKeyPointIds === undefined && input.establishedEvidenceIds === undefined) {
    throw new Error('MISSING_DISCOVERY_RESULT');
  }
  if (input.fullyCoveredKeyPointIds !== undefined && input.establishedEvidenceIds !== undefined) {
    throw new Error('AMBIGUOUS_DISCOVERY_RESULT');
  }
  const ids = uniqueKeyPointIds(input.fullyCoveredKeyPointIds ?? []);
  const evidenceIds = uniqueEvidenceIds(input.establishedEvidenceIds ?? []);
  const evidenceMode = input.establishedEvidenceIds !== undefined;
  const now = dependencies.now ?? new Date();
  const scheduleProgressSummary = progressSummaryScheduler(dependencies);

  await transactionFor(dependencies)(async (sql) => {
    const actions = await sql<ActionRow[]>`
      select
        id,
        game_id as "gameId",
        player_id as "playerId",
        action_type as "actionType",
        status,
        lease_owner as "leaseOwner",
        lease_expires_at as "leaseExpiresAt",
        result_resource_id::text as "resultResourceId"
      from private.game_actions
      where id = ${input.actionId}
      for update
    `;
    const action = actions[0];
    if (!action || action.status === 'COMPLETED' || action.actionType !== 'NORMAL_MESSAGE') return;
    if (!activeLease(action, input.workerId, now)) return;

    const games = await sql<GameRow[]>`
      select id, status
      from api.games
      where id = ${action.gameId}
      for update
    `;
    const game = games[0];
    if (!game || game.status !== 'ACTIVE') return;
    if (!action.resultResourceId) return;

    const messages = await sql<MessageRow[]>`
      select id, game_id as "gameId", player_id as "playerId", status
      from api.messages
      where id = ${action.resultResourceId}
        and game_id = ${action.gameId}
        and player_id = ${action.playerId}
      for update
    `;
    const message = messages[0];
    if (!message || message.status !== 'PENDING') return;

    if (evidenceMode) {
      const knownEvidence = await sql<Array<{ id: string }>>`
        select evidence.id
        from private.key_point_evidence evidence
        join private.key_points points on points.id = evidence.key_point_id
        where points.game_id = ${action.gameId}
        order by evidence.id
      `;
      const knownEvidenceIds = new Set(knownEvidence.map(({ id }) => id));
      for (const evidenceId of evidenceIds) {
        if (!knownEvidenceIds.has(evidenceId)) throw new Error('UNKNOWN_EVIDENCE_ID');
      }

      await sql`
        insert into private.question_judgments
          (
            message_id,
            game_id,
            player_id,
            original_verdict,
            original_covered_key_point_ids,
            original_established_evidence_ids,
            current_verdict,
            current_covered_key_point_ids,
            current_established_evidence_ids,
            prompt_version,
            schema_version,
            completed_at,
            updated_at
          )
        values
          (
            ${message.id},
            ${action.gameId},
            ${action.playerId},
            ${input.verdict},
            '{}',
            ${evidenceIds},
            ${input.verdict},
            '{}',
            ${evidenceIds},
            'question-judge-v7',
            ${EVIDENCE_QUESTION_JUDGE_SCHEMA_VERSION},
            now(),
            now()
          )
        on conflict (message_id) do nothing
      `;
      await sql`
        update api.messages
        set status = 'JUDGED',
            verdict = ${input.verdict},
            awarded_points = 0,
            judged_at = now(),
            updated_at = now()
        where id = ${message.id} and status = 'PENDING'
      `;
      await rebuildEvidenceProgressInTransaction(sql, action.gameId);
      const targetProgress = await sql<Array<{ coveredKeyPointIds: string[] }>>`
        select current_covered_key_point_ids as "coveredKeyPointIds"
        from private.question_judgments
        where message_id = ${message.id} and game_id = ${action.gameId}
      `;
      await sql`
        update private.question_judgments
        set original_covered_key_point_ids = ${targetProgress[0]?.coveredKeyPointIds ?? []}::uuid[],
            updated_at = now()
        where message_id = ${message.id} and game_id = ${action.gameId}
      `;
      await sql`
        update private.game_actions
        set status = 'COMPLETED',
            lease_owner = null,
            lease_expires_at = null,
            error_code = null,
            updated_at = now()
        where id = ${input.actionId}
          and status = 'PROCESSING'
          and lease_owner = ${input.workerId}
      `;
      await scheduleQuestionBoundary(sql, action.gameId, scheduleProgressSummary);
      return;
    }

    for (const keyPointId of ids) {
      // Key points are immutable after activation; a read is enough to
      // validate the model's claim without granting the worker UPDATE.
      const keyPoints = await sql<Array<{ id: string }>>`
        select id
        from private.key_points
        where id = ${keyPointId}
          and game_id = ${action.gameId}
        order by id
      `;
      if (!keyPoints[0]) throw new Error('UNKNOWN_KEY_POINT_ID');
    }

    await sql`
      insert into private.question_judgments
        (
          message_id,
          game_id,
          player_id,
          original_verdict,
          original_covered_key_point_ids,
          current_verdict,
          current_covered_key_point_ids,
          prompt_version,
          schema_version,
          completed_at,
          updated_at
        )
      values
        (
          ${message.id},
          ${action.gameId},
          ${action.playerId},
          ${input.verdict},
          ${ids},
          ${input.verdict},
          ${ids},
          ${QUESTION_JUDGE_PROMPT_VERSION},
          ${QUESTION_JUDGE_SCHEMA_VERSION},
          now(),
          now()
        )
      on conflict (message_id) do nothing
    `;

    let newlyClaimed = 0;
    for (const keyPointId of ids) {
      const claims = await sql<Array<{ keyPointId: string }>>`
        insert into private.key_point_claims
          (key_point_id, game_id, message_id, player_id, claimed_at)
        values (${keyPointId}, ${action.gameId}, ${message.id}, ${action.playerId}, now())
        on conflict (key_point_id) do nothing
        returning key_point_id as "keyPointId"
      `;
      newlyClaimed += claims.length;
    }

    if (newlyClaimed > 0) {
      await sql`
        update api.players
        set lifetime_score = lifetime_score + ${newlyClaimed},
            updated_at = now()
        where id = ${action.playerId}
      `;
    }
    await sql`
      update api.games
      set discovered_key_point_count = discovered_key_point_count + ${newlyClaimed},
          updated_at = now()
      where id = ${action.gameId} and status = 'ACTIVE'
    `;
    await sql`
      update api.messages
      set status = 'JUDGED',
          verdict = ${input.verdict},
          awarded_points = ${newlyClaimed},
          judged_at = now(),
          updated_at = now()
      where id = ${message.id} and status = 'PENDING'
    `;
    await sql`
      update api.game_player_stats
      set yes_count = yes_count + ${input.verdict === 'YES' ? 1 : 0},
          updated_at = now()
      where game_id = ${action.gameId} and player_id = ${action.playerId}
    `;
    await sql`
      update private.game_actions
      set status = 'COMPLETED',
          lease_owner = null,
          lease_expires_at = null,
          error_code = null,
          updated_at = now()
      where id = ${input.actionId}
        and status = 'PROCESSING'
        and lease_owner = ${input.workerId}
    `;
    await scheduleQuestionBoundary(sql, action.gameId, scheduleProgressSummary);
  });
}
