import type { PublicGameSnapshot } from '@turtle-soup/contracts';

/**
 * Safe, public-only data used while the local Supabase stack is unavailable.
 * The active snapshot intentionally contains no solution or hidden key points.
 */
export const demoSnapshot: PublicGameSnapshot = {
  game: {
    id: 'demo-game',
    status: 'ACTIVE',
    puzzleSurface: '有人在海边捡到了一把伞。为什么这把伞会改变整件事？',
    keyPointTotal: 3,
    discoveredKeyPointCount: 1,
    totalQuestionCount: 2,
    endReason: null,
    winnerPlayerId: null,
    createdAt: '2026-08-14T12:00:00.000Z',
    activatedAt: '2026-08-14T12:02:00.000Z',
    endedAt: null,
    updatedAt: '2026-08-14T12:05:00.000Z',
  },
  players: [
    {
      id: 'demo-player-cups',
      displayNickname: 'Cups',
      lifetimeScore: 2,
      createdAt: '2026-08-14T12:00:00.000Z',
    },
    {
      id: 'demo-player-alice',
      displayNickname: 'Alice',
      lifetimeScore: 1,
      createdAt: '2026-08-14T12:01:00.000Z',
    },
  ],
  messages: [
    {
      id: 'demo-message-1',
      gameId: 'demo-game',
      playerId: 'demo-player-alice',
      sequenceNo: 1,
      content: '这把伞是不是和天气有关？',
      status: 'JUDGED',
      verdict: 'NO',
      awardedPoints: 0,
      createdAt: '2026-08-14T12:03:00.000Z',
      judgedAt: '2026-08-14T12:03:01.000Z',
      updatedAt: '2026-08-14T12:03:01.000Z',
    },
    {
      id: 'demo-message-2',
      gameId: 'demo-game',
      playerId: 'demo-player-cups',
      sequenceNo: 2,
      content: '伞下是不是藏着关键线索？',
      status: 'PENDING',
      verdict: null,
      awardedPoints: 0,
      createdAt: '2026-08-14T12:04:00.000Z',
      judgedAt: null,
      updatedAt: '2026-08-14T12:04:00.000Z',
    },
  ],
  events: [],
  stats: [
    {
      gameId: 'demo-game',
      playerId: 'demo-player-cups',
      displayNickname: 'Cups',
      lifetimeScore: 2,
      questionCount: 1,
      yesCount: 0,
      hitRate: 0,
      updatedAt: '2026-08-14T12:04:00.000Z',
    },
    {
      gameId: 'demo-game',
      playerId: 'demo-player-alice',
      displayNickname: 'Alice',
      lifetimeScore: 1,
      questionCount: 1,
      yesCount: 0,
      hitRate: 0,
      updatedAt: '2026-08-14T12:04:00.000Z',
    },
  ],
  reveal: null,
};
