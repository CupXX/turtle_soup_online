import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  RETRY_SECONDS,
} from './queue.js';

type ProgressSummaryQueue = {
  fingerprintProgressSummarySource: (questions: ReadonlyArray<{
    sequence_no: number;
    question: string;
    verdict: 'YES' | 'NO' | 'BOTH' | 'IRRELEVANT';
  }>) => string;
  loadProgressSummaryBoundary: (sql: Sql, gameId: string, throughQuestionCount: number) => Promise<{
    throughQuestionCount: number;
    throughSequenceNo: number;
    sourceFingerprint: string;
    questions: Array<{ sequence_no: number; question: string; verdict: 'YES' | 'NO' | 'BOTH' | 'IRRELEVANT' }>;
  }>;
  ensureProgressSummaryJobForBoundary: (sql: Sql, gameId: string, throughQuestionCount: number) => Promise<void>;
  reconcileActiveGameProgressSummary: (sql: Sql) => Promise<void>;
  claimNextProgressSummary: (workerId: string, now: Date, dependencies?: { transaction?: unknown }) => Promise<{
    id: string;
    gameId: string;
    throughQuestionCount: number;
    throughSequenceNo: number;
    sourceFingerprint: string;
    attempt: number;
    leaseOwner: string;
    leaseExpiresAt: string;
  } | null>;
  recordProgressSummaryRetry: (jobId: string, attempt: number, code: string, dependencies?: { transaction?: unknown; now?: Date }) => Promise<void>;
  markProgressSummaryBlocked: (jobId: string, code: string, dependencies?: { transaction?: unknown; now?: Date }) => Promise<void>;
};

async function loadQueue(): Promise<ProgressSummaryQueue> {
  const module = await import('./progress-summary-queue.js').catch(() => null);
  expect(module).not.toBeNull();
  return module as unknown as ProgressSummaryQueue;
}

function fakeSql(handler: (query: string) => unknown[]) {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
    calls.push(query);
    return Promise.resolve(handler(query) as never);
  }) as unknown as Sql;
  return { calls, sql };
}

function fakeTransaction(results: unknown[][]) {
  const calls: string[] = [];
  const transaction = async <T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> => {
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
      calls.push(query);
      return Promise.resolve((results.shift() ?? []) as never);
    }) as unknown as TransactionSql;
    return callback(sql);
  };
  return { calls, transaction };
}

const gameId = '00000000-0000-4000-8000-000000000001';
const sourceRows = [
  { sequence_no: 4, question: '问题一', verdict: 'YES' as const },
  { sequence_no: 9, question: '问题二', verdict: 'NO' as const },
  { sequence_no: 12, question: '问题三', verdict: 'IRRELEVANT' as const },
];

function publicRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    sequence_no: index + 1,
    question: `问题${index + 1}`,
    verdict: (index % 2 === 0 ? 'YES' : 'NO') as 'YES' | 'NO',
  }));
}

describe('progress summary source and scheduler', () => {
  it('creates a deterministic lowercase SHA-256 fingerprint from ordered public rows', async () => {
    const queue = await loadQueue();
    const first = queue.fingerprintProgressSummarySource(sourceRows);
    const second = queue.fingerprintProgressSummarySource(sourceRows);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(queue.fingerprintProgressSummarySource([{ ...sourceRows[0], verdict: 'NO' }])).not.toBe(first);
    expect(queue.fingerprintProgressSummarySource([...sourceRows].reverse())).not.toBe(first);
  });

  it('loads exactly the first N current judged messages and uses the Nth sequence number', async () => {
    const queue = await loadQueue();
    const rows = publicRows(10);
    const fake = fakeSql((query) => query.toLowerCase().includes('from api.messages') ? rows : []);

    await expect(queue.loadProgressSummaryBoundary(fake.sql, gameId, 10)).resolves.toMatchObject({
      throughQuestionCount: 10,
      throughSequenceNo: 10,
      questions: rows,
    });
    const query = fake.calls[0].toLowerCase();
    expect(query).toContain("status = 'judged'");
    expect(query).toContain('order by sequence_no asc');
    expect(query).toContain('limit 10');
    expect(query).not.toContain('private.question_judgments');
    expect(query).not.toContain('full_solution');
  });

  it('rejects boundaries below ten or not divisible by ten', async () => {
    const queue = await loadQueue();
    const fake = fakeSql(() => []);

    await expect(queue.loadProgressSummaryBoundary(fake.sql, gameId, 9)).rejects.toThrow(/boundary/i);
    await expect(queue.ensureProgressSummaryJobForBoundary(fake.sql, gameId, 11)).rejects.toThrow(/boundary/i);
  });

  it('does not enqueue when READY already represents the same boundary and fingerprint', async () => {
    const queue = await loadQueue();
    const rows = publicRows(10);
    const fingerprint = queue.fingerprintProgressSummarySource(rows);
    const fake = fakeSql((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('from api.messages')) return rows;
      if (normalized.includes('from api.game_progress_summaries')) {
        return [{ generationStatus: 'READY', throughQuestionCount: 10, sourceFingerprint: fingerprint }];
      }
      throw new Error(`unexpected query: ${query}`);
    });

    await expect(queue.ensureProgressSummaryJobForBoundary(fake.sql, gameId, 10)).resolves.toBeUndefined();
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('progress_summary_jobs');
  });

  it.each(['PENDING', 'PROCESSING', 'RETRY', 'BLOCKED', 'COMPLETED', 'STALE', 'CANCELLED'])(
    'does not duplicate a same-source job in %s status',
    async (status) => {
      const queue = await loadQueue();
      const rows = publicRows(10);
      const fake = fakeSql((query) => {
        const normalized = query.toLowerCase();
        if (normalized.includes('from api.messages')) return rows;
        if (normalized.includes('from api.game_progress_summaries')) return [];
        if (normalized.includes('from private.progress_summary_jobs')) return [{ id: 'job-1', status }];
        throw new Error(`unexpected query: ${query}`);
      });

      await expect(queue.ensureProgressSummaryJobForBoundary(fake.sql, gameId, 10)).resolves.toBeUndefined();
      expect(fake.calls.join('\n').toLowerCase()).not.toContain('insert into private.progress_summary_jobs');
    },
  );

  it('enqueues a changed same-boundary source and preserves older successful facts', async () => {
    const queue = await loadQueue();
    const rows = publicRows(10);
    const fake = fakeSql((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('from api.messages')) return rows;
      if (normalized.includes('from api.game_progress_summaries')) {
        return [{ generationStatus: 'READY', throughQuestionCount: 10, sourceFingerprint: '0'.repeat(64) }];
      }
      if (normalized.includes('from private.progress_summary_jobs')) return [];
      return [{ id: 'job-1' }];
    });

    await expect(queue.ensureProgressSummaryJobForBoundary(fake.sql, gameId, 10)).resolves.toBeUndefined();
    const queries = fake.calls.join('\n').toLowerCase();
    expect(queries).toContain('insert into private.progress_summary_jobs');
    expect(queries).toContain('insert into api.game_progress_summaries');
    expect(queries).toContain('target_question_count');
    expect(queries).not.toContain('confirmed_facts =');
    expect(queries).not.toContain('ruled_out_facts =');
    expect(queries).not.toContain('irrelevant_topics =');
  });

  it.each([
    [0, null],
    [9, null],
    [10, 10],
    [19, 10],
    [20, 20],
    [41, 40],
  ])('reconciles %s judged messages to boundary %s', async (judgedCount, expectedBoundary) => {
    const queue = await loadQueue();
    const fake = fakeSql((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('from api.games')) return [{ id: gameId }];
      if (normalized.includes('count(*)') && normalized.includes('from api.messages')) return [{ count: judgedCount }];
      if (normalized.includes('from api.messages')) return publicRows(Number(expectedBoundary ?? 0));
      if (normalized.includes('from api.game_progress_summaries')) return [];
      if (normalized.includes('from private.progress_summary_jobs')) return [];
      return [{ id: 'job-1' }];
    });

    await expect(queue.reconcileActiveGameProgressSummary(fake.sql)).resolves.toBeUndefined();
    const queries = fake.calls.join('\n').toLowerCase();
    if (expectedBoundary === null) {
      expect(queries).not.toContain('insert into private.progress_summary_jobs');
    } else {
      expect(queries).toContain('insert into private.progress_summary_jobs');
      expect(queries).toMatch(new RegExp(`\\n\\s+${expectedBoundary},`));
    }
  });

  it('does nothing without an ACTIVE game and never reads ENDED history', async () => {
    const queue = await loadQueue();
    const noActive = fakeSql((query) => query.toLowerCase().includes('from api.games') ? [] : (() => { throw new Error('unexpected query'); })());

    await expect(queue.reconcileActiveGameProgressSummary(noActive.sql)).resolves.toBeUndefined();
    expect(noActive.calls).toHaveLength(1);
    expect(noActive.calls[0].toLowerCase()).toContain("status = 'active'");
  });

  it('lets concurrent reconciliation attempts converge on the database unique key', async () => {
    const queue = await loadQueue();
    const rows = publicRows(10);
    let insertCount = 0;
    const fake = fakeSql((query) => {
      const normalized = query.toLowerCase();
      if (normalized.includes('from api.games')) return [{ id: gameId }];
      if (normalized.includes('count(*)') && normalized.includes('from api.messages')) return [{ count: 10 }];
      if (normalized.includes('from api.messages')) return rows;
      if (normalized.includes('from api.game_progress_summaries')) return [];
      if (normalized.includes('from private.progress_summary_jobs')) return [];
      if (normalized.includes('insert into private.progress_summary_jobs')) {
        insertCount += 1;
        return insertCount === 1 ? [{ id: 'job-1' }] : [];
      }
      return [];
    });

    await Promise.all([
      queue.reconcileActiveGameProgressSummary(fake.sql),
      queue.reconcileActiveGameProgressSummary(fake.sql),
    ]);
    expect(insertCount).toBe(2);
    expect(fake.calls.filter((query) => query.toLowerCase().includes('insert into api.game_progress_summaries'))).toHaveLength(1);
  });

  it('claims a pending summary with the shared lease and increments its attempt', async () => {
    const queue = await loadQueue();
    const fake = fakeTransaction([
      [{
        id: '00000000-0000-4000-8000-000000000002',
        gameId,
        throughQuestionCount: 10,
        throughSequenceNo: 12,
        sourceFingerprint: 'a'.repeat(64),
        attempt: 0,
      }],
      [{
        id: '00000000-0000-4000-8000-000000000002',
        gameId,
        throughQuestionCount: 10,
        throughSequenceNo: 12,
        sourceFingerprint: 'a'.repeat(64),
        attempt: 1,
        leaseOwner: 'worker-1',
        leaseExpiresAt: '2026-08-18T20:01:00.000Z',
      }],
    ]);

    await expect(queue.claimNextProgressSummary('worker-1', new Date('2026-08-18T20:00:00.000Z'), {
      transaction: fake.transaction,
    })).resolves.toMatchObject({
      gameId,
      throughQuestionCount: 10,
      throughSequenceNo: 12,
      attempt: 1,
      leaseOwner: 'worker-1',
    });
    expect(fake.calls[0].toLowerCase()).toContain('for update of jobs');
    expect(fake.calls[0].toLowerCase()).toContain("status in ('pending', 'retry')");
    expect(fake.calls[1].toLowerCase()).toContain("status = 'processing'");
  });

  it('reuses 2/5/15 second retries and blocks on attempt four', async () => {
    const queue = await loadQueue();
    expect(RETRY_SECONDS).toEqual([2, 5, 15]);

    const retry = fakeTransaction([[]]);
    await expect(queue.recordProgressSummaryRetry('job-1', 2, 'TIMEOUT', {
      transaction: retry.transaction,
      now: new Date('2026-08-18T20:00:00.000Z'),
    })).resolves.toBeUndefined();
    expect(retry.calls[0].toLowerCase()).toContain("status = 'retry'");
    expect(retry.calls[0].toLowerCase()).toContain('next_attempt_at');
    expect(retry.calls[0]).toContain('attempt_count = 2');

    const blocked = fakeTransaction([[
      {
        gameId,
        throughQuestionCount: 10,
        sourceFingerprint: 'b'.repeat(64),
      },
    ], []]);
    await expect(queue.recordProgressSummaryRetry('job-1', 4, 'SCHEMA_INVALID', {
      transaction: blocked.transaction,
    })).resolves.toBeUndefined();
    expect(blocked.calls[0].toLowerCase()).toContain("status = 'blocked'");
    expect(blocked.calls[1].toLowerCase()).toContain("generation_status = 'error'");
    expect(blocked.calls[1].toLowerCase()).toContain('target_source_fingerprint');
  });
});
