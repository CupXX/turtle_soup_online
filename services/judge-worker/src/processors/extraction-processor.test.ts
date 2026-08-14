import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import type { KeyPointExtractionResult, SemanticJudge } from '@turtle-soup/contracts';
import { processExtraction } from './extraction-processor.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';

function inputSql(rows: Array<Record<string, unknown>>) {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, ''));
    return Promise.resolve(rows.splice(0, rows.length) as never);
  }) as unknown as Sql;
  return { sql, calls };
}

function transaction() {
  const calls: string[] = [];
  const runner = async <T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> => {
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, ''));
      if (calls.length === 1) {
        return Promise.resolve([{
          id: jobId,
          gameId,
          inputVersion: 1,
          status: 'PROCESSING',
          leaseOwner: 'worker-1',
          leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        }] as never);
      }
      if (calls.length === 2) return Promise.resolve([{ id: gameId, status: 'WAITING', puzzleSurface: '表面' }] as never);
      if (calls.length === 3) return Promise.resolve([{ gameId, inputVersion: 1, puzzleSurface: '表面' }] as never);
      return Promise.resolve([] as never);
    }) as unknown as TransactionSql;
    return callback(sql);
  };
  return { runner, calls };
}

const extraction: KeyPointExtractionResult = {
  key_points: [{ content: '线索一' }, { content: '线索二' }, { content: '线索三' }],
};

describe('processExtraction', () => {
  it('loads only the claimed secret version and waits for the judge before opening the write transaction', async () => {
    const read = inputSql([{ puzzleSurface: '表面', fullSolution: '真相', inputVersion: 1 }]);
    const writes = transaction();
    const order: string[] = [];
    const judge: SemanticJudge = {
      extractKeyPoints: async (input) => {
        order.push(`judge:${input.puzzle_surface}:${input.full_solution}`);
        await Promise.resolve();
        return extraction;
      },
      judgeQuestion: async () => ({ verdict: 'NO', fully_covered_key_point_ids: [] }),
      judgeFinalAnswer: async () => ({ covered_key_point_ids: [] }),
    };
    const transactionWithOrder = async <T>(callback: (sql: TransactionSql) => Promise<T>) => {
      order.push('transaction');
      return writes.runner(callback);
    };

    await processExtraction({ id: jobId, gameId, inputVersion: 1, attempt: 1, leaseOwner: 'worker-1', leaseExpiresAt: '2099-01-01T00:00:00.000Z' }, {
      judge,
      workerId: 'worker-1',
      sql: read.sql,
      transaction: transactionWithOrder,
      idFactory: () => '00000000-0000-4000-8000-000000000003',
    });

    expect(order).toEqual(['judge:表面:真相', 'transaction']);
    expect(read.calls[0].toLowerCase()).toContain('private.game_secrets');
    expect(read.calls[0].toLowerCase()).toContain('input_version');
    expect(read.calls[0]).toContain(gameId);
  });

  it('fails before judging when the claimed secret version is missing', async () => {
    const read = inputSql([]);
    let judged = false;
    const judge = {
      extractKeyPoints: async () => {
        judged = true;
        return extraction;
      },
    } as unknown as SemanticJudge;

    await expect(processExtraction({ id: jobId, gameId, inputVersion: 1, attempt: 1, leaseOwner: 'worker-1', leaseExpiresAt: '2099-01-01T00:00:00.000Z' }, {
      judge,
      workerId: 'worker-1',
      sql: read.sql,
      transaction: transaction().runner,
    })).rejects.toThrow('EXTRACTION_INPUT_NOT_FOUND');
    expect(judged).toBe(false);
  });
});
