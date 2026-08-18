import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { completeProgressSummary } from './complete-progress-summary.js';
import { fingerprintProgressSummarySource, markProgressSummaryBlocked } from './progress-summary-queue.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';
const sourceRows = Array.from({ length: 10 }, (_, index) => ({
  sequence_no: index + 1,
  question: `问题${index + 1}`,
  verdict: (index % 2 === 0 ? 'YES' : 'NO') as 'YES' | 'NO',
}));
const sourceFingerprint = fingerprintProgressSummarySource(sourceRows);
const summary = {
  confirmed_facts: ['确认事实'],
  ruled_out_facts: ['排除事实'],
  irrelevant_topics: ['无关主题'],
};

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

const input = {
  job: {
    id: jobId,
    gameId,
    throughQuestionCount: 10,
    throughSequenceNo: 10,
    sourceFingerprint,
    attempt: 1,
    leaseOwner: 'worker-1',
    leaseExpiresAt: '2099-01-01T00:00:00.000Z',
  },
  result: summary,
};

describe('completeProgressSummary', () => {
  it('publishes READY atomically and clears target metadata for an active unchanged lease', async () => {
    const fake = fakeTransaction([
      [{ id: jobId, gameId, throughQuestionCount: 10, throughSequenceNo: 10, sourceFingerprint, status: 'PROCESSING', leaseOwner: 'worker-1', leaseExpiresAt: '2099-01-01T00:00:00.000Z' }],
      sourceRows,
      [],
      [],
    ]);

    await expect(completeProgressSummary(input, {
      transaction: fake.transaction,
      now: new Date('2026-08-18T20:00:00.000Z'),
    })).resolves.toBeUndefined();
    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain("generation_status = 'ready'");
    expect(query).toContain('confirmed_facts');
    expect(query).toContain('target_question_count = null');
    expect(query).toContain("status = 'completed'");
  });

  it.each([
    ['lost lease', { status: 'PROCESSING', leaseOwner: 'worker-2', leaseExpiresAt: '2099-01-01T00:00:00.000Z' }],
    ['expired lease', { status: 'PROCESSING', leaseOwner: 'worker-1', leaseExpiresAt: '2020-01-01T00:00:00.000Z' }],
    ['replayed completion', { status: 'COMPLETED', leaseOwner: null, leaseExpiresAt: null }],
  ])('does not publish for %s', async (_label, state) => {
    const fake = fakeTransaction([[{ id: jobId, gameId, throughQuestionCount: 10, throughSequenceNo: 10, sourceFingerprint, ...state }]]);

    await expect(completeProgressSummary(input, {
      transaction: fake.transaction,
      now: new Date('2026-08-18T20:00:00.000Z'),
    })).resolves.toBeUndefined();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls.join('\n').toLowerCase()).not.toContain('generation_status =');
  });

  it('marks a source race stale and preserves the previous READY arrays', async () => {
    const changedRows = sourceRows.map((row, index) => index === 2 ? { ...row, verdict: 'BOTH' as const } : row);
    const changedFingerprint = fingerprintProgressSummarySource(changedRows);
    const fake = fakeTransaction([
      [{ id: jobId, gameId, throughQuestionCount: 10, throughSequenceNo: 10, sourceFingerprint, status: 'PROCESSING', leaseOwner: 'worker-1', leaseExpiresAt: '2099-01-01T00:00:00.000Z' }],
      changedRows,
      [],
      [],
      [{ id: 'replacement-job' }],
      [],
    ]);

    await completeProgressSummary(input, {
      transaction: fake.transaction,
      now: new Date('2026-08-18T20:00:00.000Z'),
    });
    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain("status = 'stale'");
    expect(query).toContain('source_fingerprint');
    expect(query).not.toContain("generation_status = 'ready'");
    expect(changedFingerprint).not.toBe(sourceFingerprint);
  });

  it('keeps older facts while a newer target is blocked, but marks only the newest target ERROR', async () => {
    const fake = fakeTransaction([
      [{ gameId, throughQuestionCount: 20, sourceFingerprint: 'c'.repeat(64) }],
      [],
    ]);

    await markProgressSummaryBlocked(jobId, 'SCHEMA_INVALID', {
      transaction: fake.transaction,
    });
    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain("status = 'blocked'");
    expect(query).toContain("generation_status = 'error'");
    expect(query).toContain('target_question_count = 20');
    expect(query).toContain('target_source_fingerprint');
  });
});
