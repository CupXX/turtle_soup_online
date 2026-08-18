import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import type { PublicGameSnapshot } from '@turtle-soup/contracts';
import { getCurrentSnapshot } from './get-current-snapshot.js';

type QueryRule = { match: string; rows: unknown[] };

function fakeSql(rules: QueryRule[]) {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    const text = Array.from(strings).join(' ');
    calls.push(text);
    return Promise.resolve(rules.find((rule) => text.toLowerCase().includes(rule.match.toLowerCase()))?.rows ?? []);
  }) as unknown as Sql;
  return { sql, calls };
}

const waitingGame = {
  id: '00000000-0000-4000-8000-000000000001',
  status: 'WAITING',
  puzzleSurface: 'should never be public while waiting',
  keyPointTotal: 0,
  discoveredKeyPointCount: 0,
  totalQuestionCount: 0,
  endReason: null,
  winnerPlayerId: null,
  createdAt: '2026-08-14T12:00:00.000Z',
  activatedAt: null,
  endedAt: null,
  updatedAt: '2026-08-14T12:00:00.000Z',
};

describe('getCurrentSnapshot', () => {
  it('returns the newest open game without private data or GET-side writes', async () => {
    const { sql, calls } = fakeSql([
      { match: 'from api.games', rows: [waitingGame] },
      { match: 'from api.game_player_stats', rows: [{ gameId: waitingGame.id, playerId: 'player-1', displayNickname: 'Cups', lifetimeScore: 0, questionCount: 0, yesCount: 0, hitRate: null, updatedAt: waitingGame.updatedAt }] },
      { match: 'from api.players', rows: [{ id: 'player-1', displayNickname: 'Cups', lifetimeScore: 0, createdAt: waitingGame.createdAt }] },
      { match: 'from api.messages', rows: [] },
      { match: 'from api.game_events', rows: [] },
    ]);

    const snapshot = await getCurrentSnapshot(sql);

    expect(snapshot?.game.puzzleSurface).toBeNull();
    expect(snapshot?.reveal).toBeNull();
    expect(snapshot?.stats[0]?.displayNickname).toBe('Cups');
    expect(calls.every((call) => !call.toLowerCase().includes('private.'))).toBe(true);
    expect(calls.every((call) => !call.toLowerCase().includes('insert '))).toBe(true);
    expect(calls.find((call) => call.toLowerCase().includes('from api.messages'))?.toLowerCase()).toContain('challenge_outcome');
  });

  it('maps ended reveal data only for the ended fallback game and preserves sequence order', async () => {
    const endedGame = {
      ...waitingGame,
      id: '00000000-0000-4000-8000-000000000002',
      status: 'ENDED',
      puzzleSurface: '公开题面',
      keyPointTotal: 2,
      discoveredKeyPointCount: 2,
      endReason: 'FINAL_ANSWER_SUCCESS',
      endedAt: '2026-08-14T12:05:00.000Z',
    };
    const { sql } = fakeSql([
      { match: 'from api.games', rows: [endedGame] },
      { match: 'from api.game_player_stats', rows: [] },
      { match: 'from api.players', rows: [] },
      { match: 'from api.messages', rows: [{ id: 'm2', sequenceNo: 2 }, { id: 'm1', sequenceNo: 1 }] },
      { match: 'from api.game_events', rows: [{ id: 'e2', sequenceNo: 2 }, { id: 'e1', sequenceNo: 1 }] },
      { match: 'from api.game_reveals', rows: [{ fullSolution: '完整真相', revealedAt: endedGame.endedAt }] },
      { match: 'from api.revealed_key_points', rows: [{ ordinal: 2, content: '第二条' }, { ordinal: 1, content: '第一条' }] },
    ]);

    const snapshot = await getCurrentSnapshot(sql);

    expect(snapshot?.game.puzzleSurface).toBe('公开题面');
    expect(snapshot?.reveal).toEqual({
      fullSolution: '完整真相',
      revealedAt: endedGame.endedAt,
      keyPoints: [{ ordinal: 1, content: '第一条' }, { ordinal: 2, content: '第二条' }],
    });
    expect(snapshot?.messages.map((message) => message.sequenceNo)).toEqual([1, 2]);
    expect(snapshot?.events.map((event) => event.sequenceNo)).toEqual([1, 2]);
  });

  it('returns null when there is no open or ended game', async () => {
    const { sql } = fakeSql([{ match: 'from api.games', rows: [] }]);

    await expect(getCurrentSnapshot(sql)).resolves.toBeNull();
  });

  it.each([
    'PENDING',
    'ERROR',
  ] as const)('maps a %s summary row while preserving the last successful facts', async (generationStatus) => {
    const { sql } = fakeSql([
      { match: 'from api.games', rows: [{ ...waitingGame, status: 'ACTIVE', puzzleSurface: '公开汤面', activatedAt: waitingGame.createdAt }] },
      { match: 'from api.game_player_stats', rows: [] },
      { match: 'from api.players', rows: [] },
      { match: 'from api.messages', rows: [] },
      { match: 'from api.game_events', rows: [] },
      {
        match: 'from api.game_progress_summaries',
        rows: [{
          gameId: waitingGame.id,
          throughQuestionCount: 10,
          throughSequenceNo: 12,
          confirmedFacts: ['已确认的旧事实'],
          ruledOutFacts: ['已排除的旧事实'],
          irrelevantTopics: ['无关方向'],
          generationStatus,
          targetQuestionCount: 20,
          generatedAt: '2026-08-14T12:10:00.000Z',
          updatedAt: '2026-08-14T12:11:00.000Z',
        }],
      },
    ]);

    const snapshot = await getCurrentSnapshot(sql);

    expect(snapshot?.progressSummary).toMatchObject({
      throughQuestionCount: 10,
      confirmedFacts: ['已确认的旧事实'],
      generationStatus,
      targetQuestionCount: 20,
    });
  });
});
