import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import type { ProgressSummaryResult, SemanticJudge } from '@turtle-soup/contracts';
import { processProgressSummary } from './progress-summary-processor.js';
import { fingerprintProgressSummarySource } from '../db/progress-summary-queue.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';
const sourceRows = Array.from({ length: 10 }, (_, index) => ({
  sequence_no: index + 1,
  question: `问题${index + 1}`,
  verdict: (index % 2 === 0 ? 'YES' : 'NO') as 'YES' | 'NO',
}));
const sourceFingerprint = fingerprintProgressSummarySource(sourceRows);

const job = {
  id: jobId,
  gameId,
  throughQuestionCount: 10,
  throughSequenceNo: 10,
  sourceFingerprint,
  attempt: 1,
  leaseOwner: 'worker-1',
  leaseExpiresAt: '2099-01-01T00:00:00.000Z',
};

const result: ProgressSummaryResult = {
  confirmed_facts: ['已确认事实'],
  ruled_out_facts: ['已排除事实'],
  irrelevant_topics: ['无关方向'],
};

function fakeRead(rows: unknown[]) {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, ''));
    return Promise.resolve(rows as never);
  }) as unknown as Sql;
  return { calls, sql };
}

function fakeTransaction(results: unknown[][]) {
  const calls: string[] = [];
  const transaction = async <T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> => {
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, ''));
      return Promise.resolve((results.shift() ?? []) as never);
    }) as unknown as TransactionSql;
    return callback(sql);
  };
  return { calls, transaction };
}

describe('processProgressSummary', () => {
  it('passes only the fixed public question/verdict source to the summarizer', async () => {
    const read = fakeRead(sourceRows);
    const writes = fakeTransaction([
      [{ id: jobId, gameId, throughQuestionCount: 10, throughSequenceNo: 10, sourceFingerprint, status: 'PROCESSING', leaseOwner: 'worker-1', leaseExpiresAt: '2099-01-01T00:00:00.000Z' }],
      sourceRows,
      [],
      [],
    ]);
    let received: unknown;
    const judge: SemanticJudge = {
      extractKeyPoints: async () => ({ key_points: [] }),
      judgeQuestion: async () => ({ verdict: 'NO', fully_covered_key_point_ids: [] }),
      judgeFinalAnswer: async () => ({ covered_key_point_ids: [] }),
      summarizeProgress: async (input) => { received = input; return result; },
    };

    await processProgressSummary({ ...job, sourceFingerprint }, {
      judge,
      workerId: 'worker-1',
      sql: read.sql,
      transaction: writes.transaction,
      now: new Date('2026-08-18T20:00:00.000Z'),
    });

    expect(received).toEqual({ questions: sourceRows });
    const serialized = JSON.stringify(received);
    expect(serialized).not.toMatch(/full_solution|key_points|evidence|score|award/i);
    expect(writes.calls.join('\n').toLowerCase()).toContain("status = 'ready'");
  });

  it('marks a changed source stale, ensures replacement, and never calls the model', async () => {
    const readRows = sourceRows.map((row, index) => index === 3 ? { ...row, verdict: 'BOTH' as const } : row);
    const read = fakeRead(readRows);
    const staleWrites = fakeTransaction([[]]);
    let judged = false;
    const judge = {
      summarizeProgress: async () => { judged = true; return result; },
    } as unknown as SemanticJudge;

    await processProgressSummary(job, {
      judge,
      workerId: 'worker-1',
      sql: read.sql,
      transaction: staleWrites.transaction,
    });

    expect(judged).toBe(false);
    expect(staleWrites.calls.join('\n').toLowerCase()).toContain("status = 'stale'");
  });
});
