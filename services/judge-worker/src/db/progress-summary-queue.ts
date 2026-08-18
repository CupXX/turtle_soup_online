import { createHash, randomUUID } from 'node:crypto';
import type { ProgressSummarySourceItem } from '@turtle-soup/contracts';
import type { Sql } from 'postgres';

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
  return createHash('sha256')
    .update(JSON.stringify(questions.map(({ sequence_no, question, verdict }) => [sequence_no, question, verdict])))
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
