import type { ProgressSummaryResult } from '@turtle-soup/contracts';
import type { Sql, TransactionSql } from 'postgres';
import { withWorkerTransaction, type WorkerTransaction } from './client.js';
import {
  ensureProgressSummaryJobForBoundary,
  loadProgressSummaryBoundary,
  type ClaimedProgressSummaryJob,
} from './progress-summary-queue.js';

export type CompleteProgressSummaryInput = {
  job: ClaimedProgressSummaryJob;
  result: ProgressSummaryResult;
};

export type CompleteProgressSummaryDependencies = {
  transaction?: WorkerTransaction;
  now?: Date;
};

type ProgressSummaryJobRow = {
  id: string;
  gameId: string;
  throughQuestionCount: number;
  throughSequenceNo: number | string;
  sourceFingerprint: string;
  status: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
};

function transactionFor(dependencies: CompleteProgressSummaryDependencies): WorkerTransaction {
  return dependencies.transaction ?? withWorkerTransaction;
}

function activeLease(job: ProgressSummaryJobRow, workerId: string, now: Date): boolean {
  if (job.status !== 'PROCESSING' || job.leaseOwner !== workerId || !job.leaseExpiresAt) return false;
  return new Date(job.leaseExpiresAt).getTime() > now.getTime();
}

async function markStaleInTransaction(
  sql: TransactionSql,
  job: ClaimedProgressSummaryJob,
): Promise<void> {
  const stale = await sql<Array<{ id: string }>>`
    update private.progress_summary_jobs
    set status = 'STALE',
        lease_owner = null,
        lease_expires_at = null,
        updated_at = now()
    where id = ${job.id}
      and game_id = ${job.gameId}
      and status = 'PROCESSING'
      and lease_owner = ${job.leaseOwner}
    returning id
  `;
  if (!stale[0]) return;

  await ensureProgressSummaryJobForBoundary(
    sql as unknown as Sql,
    job.gameId,
    job.throughQuestionCount,
  );
}

export async function markProgressSummaryStale(
  job: ClaimedProgressSummaryJob,
  dependencies: CompleteProgressSummaryDependencies = {},
): Promise<void> {
  await transactionFor(dependencies)(async (sql) => {
    await markStaleInTransaction(sql, job);
  });
}

export async function completeProgressSummary(
  input: CompleteProgressSummaryInput,
  dependencies: CompleteProgressSummaryDependencies = {},
): Promise<void> {
  const now = dependencies.now ?? new Date();

  await transactionFor(dependencies)(async (sql) => {
    const jobs = await sql<ProgressSummaryJobRow[]>`
      select
        id,
        game_id as "gameId",
        through_question_count as "throughQuestionCount",
        through_sequence_no as "throughSequenceNo",
        source_fingerprint as "sourceFingerprint",
        status,
        lease_owner as "leaseOwner",
        lease_expires_at as "leaseExpiresAt"
      from private.progress_summary_jobs
      where id = ${input.job.id}
      for update
    `;
    const job = jobs[0];
    if (!job || job.gameId !== input.job.gameId || !activeLease(job, input.job.leaseOwner, now)) return;

    const source = await loadProgressSummaryBoundary(
      sql as unknown as Sql,
      job.gameId,
      job.throughQuestionCount,
    );
    if (
      source.throughQuestionCount !== job.throughQuestionCount
      || source.throughSequenceNo !== Number(job.throughSequenceNo)
      || source.sourceFingerprint !== job.sourceFingerprint
    ) {
      await markStaleInTransaction(sql, input.job);
      return;
    }

    await sql`
      insert into api.game_progress_summaries (
        game_id,
        through_question_count,
        through_sequence_no,
        source_fingerprint,
        confirmed_facts,
        ruled_out_facts,
        irrelevant_topics,
        generation_status,
        target_question_count,
        target_sequence_no,
        target_source_fingerprint,
        generated_at,
        updated_at
      ) values (
        ${job.gameId},
        ${job.throughQuestionCount},
        ${source.throughSequenceNo},
        ${job.sourceFingerprint},
        ${input.result.confirmed_facts},
        ${input.result.ruled_out_facts},
        ${input.result.irrelevant_topics},
        'READY',
        null,
        null,
        null,
        now(),
        now()
      )
      on conflict (game_id) do update set
        through_question_count = excluded.through_question_count,
        through_sequence_no = excluded.through_sequence_no,
        source_fingerprint = excluded.source_fingerprint,
        confirmed_facts = excluded.confirmed_facts,
        ruled_out_facts = excluded.ruled_out_facts,
        irrelevant_topics = excluded.irrelevant_topics,
        generation_status = 'READY',
        target_question_count = null,
        target_sequence_no = null,
        target_source_fingerprint = null,
        generated_at = now(),
        updated_at = now()
      where api.game_progress_summaries.through_question_count <= excluded.through_question_count
    `;

    await sql`
      update private.progress_summary_jobs
      set status = 'COMPLETED',
          lease_owner = null,
          lease_expires_at = null,
          error_code = null,
          updated_at = now()
      where id = ${input.job.id}
        and status = 'PROCESSING'
        and lease_owner = ${input.job.leaseOwner}
    `;
  });
}
