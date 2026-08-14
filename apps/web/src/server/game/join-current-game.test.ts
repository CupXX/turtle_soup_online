import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { joinCurrentGame } from './join-current-game.js';

function fakeTransaction(rows: unknown[]) {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    calls.push(Array.from(strings).join(' '));
    return Promise.resolve(rows);
  }) as unknown as TransactionSql;
  return { sql, calls };
}

describe('joinCurrentGame', () => {
  it('locks the current open game and idempotently creates zeroed player stats', async () => {
    const { sql, calls } = fakeTransaction([{ id: '00000000-0000-4000-8000-000000000001' }]);

    await expect(joinCurrentGame(sql, '00000000-0000-4000-8000-000000000010')).resolves.toEqual({
      gameId: '00000000-0000-4000-8000-000000000001',
    });

    const query = calls.join('\n').toLowerCase();
    expect(query).toContain('for update');
    expect(query).toContain('on conflict');
    expect(query).toContain('do nothing');
    expect(query).not.toContain('lifetime_score =');
    expect(query).not.toContain('question_count =');
  });

  it('returns null when there is no waiting or active game', async () => {
    const { sql, calls } = fakeTransaction([]);

    await expect(joinCurrentGame(sql, '00000000-0000-4000-8000-000000000010')).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });
});
