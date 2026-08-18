import { createHash, randomUUID } from 'node:crypto';
import type { JudgeErrorCode, ProgressSummarySourceItem } from '@turtle-soup/contracts';
import type { Sql } from 'postgres';
import { PROGRESS_SUMMARY_PROMPT_VERSION } from '../skills/progress-summary.js';
import { withWorkerTransaction, type WorkerTransaction } from './client.js';
import { LEASE_SECONDS, type QueueDependencies, retryDelaySeconds } from './queue.js';

const MIN_PROGRESS_SUMMARY_BOUNDARY = 10;

type ProgressSummarySourceRow = {
  sequence_no: number | bigint | string;
  question: string;
  verdict: ProgressSummarySourceItem['verdict'];
};

type PublicProgressSummaryRow = {
  generationStatus: 'PENDING' | 'READY' | 'ERROR';
  throughQuestionCount: number;
  sourceFingerprint: string | null;
};

export type ProgressSummaryBoundary = {
  throughQuestionCount: number;
  throughSequenceNo: number;
  sourceFingerprint: string;
  questions: ProgressSummarySourceItem[];
};

export type ClaimedProgressSummaryJob = {
  id: string;
  gameId: string;
  throughQuestionCount: number;
  throughSequenceNo: number;
  sourceFingerprint: string;
  attempt: number;
  leaseOwner: string;
  leaseExpiresAt: string;
};

type ProgressSummaryCandidate = Pick<ClaimedProgressSummaryJob, 'id' | 'gameId' | 'throughQuestionCount' | 'throughSequenceNo' | 'sourceFingerprint' | 'attempt'>;

function transactionFor(dependencies: QueueDependencies): WorkerTransaction {
  return dependencies.transaction ?? withWorkerTransaction;
}

function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + LEASE_SECONDS * 1000);
}

function assertProgressSummaryBoundary(throughQuestionCount: number): void {
  if (
    !Number.isInteger(throughQuestionCount)
    || throughQuestionCount < MIN_PROGRESS_SUMMARY_BOUNDARY
    || throughQuestionCount % MIN_PROGRESS_SUMMARY_BOUNDARY !== 0
  ) {
    throw new Error('Progress summary boundary must be a positive multiple of 10');
  }
}

export function fingerprintProgressSummarySource(
  questions: readonly ProgressSummarySourceItem[],
): string {
  const canonicalQuestions = questions.map(
    ({ sequence_no, question, verdict }) => [sequence_no, question, verdict],
  );
  return createHash('sha256')
    .update(JSON.stringify({
      policy_version: PROGRESS_SUMMARY_PROMPT_VERSION,
      questions: canonicalQuestions,
    }))
    .digest('hex');
}

export async function loadProgressSummaryBoundary(
  sql: Sql,
  gameId: string,
  throughQuestionCount: number,
): Promise<ProgressSummaryBoundary> {
  assertProgressSummaryBoundary(throughQuestionCount);

  const rows = await sql<ProgressSummarySourceRow[]>`
    select
      sequence_no,
      content as question,
      verdict
    from api.messages
    where game_id = ${gameId}
      and status = 'JUDGED'
      and verdict is not null
    order by sequence_no asc
    limit ${throughQuestionCount}
  `;

  if (rows.length < throughQuestionCount) {
    throw new Error(`Progress summary boundary ${throughQuestionCount} has insufficient judged messages`);
  }

  const questions = rows.slice(0, throughQuestionCount).map((row) => ({
    sequence_no: Number(row.sequence_no),
    question: row.question,
    verdict: row.verdict,
  }));

  return {
    throughQuestionCount,
    throughSequenceNo: questions[questions.length - 1].sequence_no,
    sourceFingerprint: fingerprintProgressSummarySource(questions),
    questions,
  };
}

export async function ensureProgressSummaryJobForBoundary(
  sql: Sql,
  gameId: string,
  throughQuestionCount: number,
): Promise<void> {
  assertProgressSummaryBoundary(throughQuestionCount);
  const boundary = await loadProgressSummaryBoundary(sql, gameId, throughQuestionCount);

  const summaries = await sql<PublicProgressSummaryRow[]>`
    select
      generation_status as "generationStatus",
      through_question_count as "throughQuestionCount",
      source_fingerprint as "sourceFingerprint"
    from api.game_progress_summaries
    where game_id = ${gameId}
    limit 1
  `;
  const summary = summaries[0];
  if (
    summary?.generationStatus === 'READY'
    && summary.throughQuestionCount === boundary.throughQuestionCount
    && summary.sourceFingerprint === boundary.sourceFingerprint
  ) {
    return;
  }

  const existingJobs = await sql<Array<{ id: string }>>`
    select id
    from private.progress_summary_jobs
    where game_id = ${gameId}
      and through_question_count = ${boundary.throughQuestionCount}
      and source_fingerprint = ${boundary.sourceFingerprint}
    limit 1
  `;
  if (existingJobs[0]) return;

  const insertedJobs = await sql<Array<{ id: string }>>`
    insert into private.progress_summary_jobs (
      id,
      game_id,
      through_question_count,
      through_sequence_no,
      source_fingerprint,
      status,
      attempt_count,
      next_attempt_at
    ) values (
      ${randomUUID()},
      ${gameId},
      ${boundary.throughQuestionCount},
      ${boundary.throughSequenceNo},
      ${boundary.sourceFingerprint},
      'PENDING',
      0,
      now()
    )
    on conflict (game_id, through_question_count, source_fingerprint) do nothing
    returning id
  `;
  if (!insertedJobs[0]) return;

  await sql`
    insert into api.game_progress_summaries (
      game_id,
      generation_status,
      target_question_count,
      target_sequence_no,
      target_source_fingerprint,
      updated_at
    ) values (
      ${gameId},
      'PENDING',
      ${boundary.throughQuestionCount},
      ${boundary.throughSequenceNo},
      ${boundary.sourceFingerprint},
      now()
    )
    on conflict (game_id) do update set
      generation_status = 'PENDING',
      target_question_count = excluded.target_question_count,
      target_sequence_no = excluded.target_sequence_no,
      target_source_fingerprint = excluded.target_source_fingerprint,
      updated_at = now()
  `;
}

export async function reconcileActiveGameProgressSummary(sql: Sql): Promise<void> {
  const activeGames = await sql<Array<{ id: string }>>`
    select id
    from api.games
    where status = 'ACTIVE'
    order by activated_at desc nulls last, created_at desc
    limit 1
  `;
  const activeGame = activeGames[0];
  if (!activeGame) return;

  const counts = await sql<Array<{ count: number | string | bigint }>>`
    select count(*)::int as count
    from api.messages
    where game_id = ${activeGame.id}
      and status = 'JUDGED'
  `;
  const judgedCount = Number(counts[0]?.count ?? 0);
  const boundary = Math.floor(judgedCount / MIN_PROGRESS_SUMMARY_BOUNDARY) * MIN_PROGRESS_SUMMARY_BOUNDARY;
  if (boundary < MIN_PROGRESS_SUMMARY_BOUNDARY) return;

  await ensureProgressSummaryJobForBoundary(sql, activeGame.id, boundary);
}

export async function claimNextProgressSummary(
  workerId: string,
  now: Date,
  dependencies: Pick<QueueDependencies, 'transaction'> = {},
): Promise<ClaimedProgressSummaryJob | null> {
  const expiresAt = leaseExpiry(now);
  return transactionFor(dependencies)(async (sql) => {
    const candidates = await sql<ProgressSummaryCandidate[]>`
      select
        jobs.id,
        jobs.game_id as "gameId",
        jobs.through_question_count as "throughQuestionCount",
        jobs.through_sequence_no as "throughSequenceNo",
        jobs.source_fingerprint as "sourceFingerprint",
        jobs.attempt_count as attempt
      from private.progress_summary_jobs jobs
      join api.games games on games.id = jobs.game_id
      where games.status = 'ACTIVE'
        and jobs.attempt_count < 4
        and jobs.next_attempt_at <= ${now}
        and (
          jobs.status in ('PENDING', 'RETRY')
          or (jobs.status = 'PROCESSING' and jobs.lease_expires_at <= ${now})
        )
      order by jobs.next_attempt_at asc, jobs.created_at asc
      limit 1
      for update of jobs
    `;
    const candidate = candidates[0];
    if (!candidate) return null;

    const leased = await sql<ClaimedProgressSummaryJob[]>`
      update private.progress_summary_jobs
      set status = 'PROCESSING',
          attempt_count = attempt_count + 1,
          lease_owner = ${workerId},
          lease_expires_at = ${expiresAt},
          updated_at = now()
      where id = ${candidate.id}
        and attempt_count < 4
      returning
        id,
        game_id as "gameId",
        through_question_count as "throughQuestionCount",
        through_sequence_no as "throughSequenceNo",
        source_fingerprint as "sourceFingerprint",
        attempt_count as attempt,
        lease_owner as "leaseOwner",
        lease_expires_at as "leaseExpiresAt"
    `;
    return leased[0] ?? null;
  });
}

export async function recordProgressSummaryRetry(
  jobId: string,
  attempt: number,
  code: JudgeErrorCode,
  dependencies: QueueDependencies = {},
): Promise<void> {
  const delay = retryDelaySeconds(attempt);
  if (delay === null) {
    await markProgressSummaryBlocked(jobId, code, dependencies);
    return;
  }

  const nextAttemptAt = new Date((dependencies.now ?? new Date()).getTime() + delay * 1000);
  await transactionFor(dependencies)(async (sql) => {
    await sql`
      update private.progress_summary_jobs
      set status = 'RETRY',
          attempt_count = ${attempt},
          next_attempt_at = ${nextAttemptAt},
          lease_owner = null,
          lease_expires_at = null,
          error_code = ${code},
          updated_at = now()
      where id = ${jobId}
        and status = 'PROCESSING'
    `;
  });
}

export async function markProgressSummaryBlocked(
  jobId: string,
  code: JudgeErrorCode,
  dependencies: QueueDependencies = {},
): Promise<void> {
  await transactionFor(dependencies)(async (sql) => {
    const blocked = await sql<Array<{
      gameId: string;
      throughQuestionCount: number;
      sourceFingerprint: string;
    }>>`
      update private.progress_summary_jobs
      set status = 'BLOCKED',
          lease_owner = null,
          lease_expires_at = null,
          error_code = ${code},
          updated_at = now()
      where id = ${jobId}
        and status = 'PROCESSING'
      returning
        game_id as "gameId",
        through_question_count as "throughQuestionCount",
        source_fingerprint as "sourceFingerprint"
    `;
    const job = blocked[0];
    if (!job) return;

    await sql`
      update api.game_progress_summaries
      set generation_status = 'ERROR',
          updated_at = now()
      where game_id = ${job.gameId}
        and target_question_count = ${job.throughQuestionCount}
        and target_source_fingerprint = ${job.sourceFingerprint}
        and generation_status = 'PENDING'
    `;
  });
}