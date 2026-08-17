import { describe, expect, it } from 'vitest';
import { rebuildEvidenceProgress } from '@turtle-soup/game-core';
import {
  CURRENT_GAME_REGRESSION_ID,
  CURRENT_GAME_REGRESSION_KEY_POINTS,
  CURRENT_GAME_REGRESSION_QUESTIONS,
  regressionJudgments,
} from './cumulative-evidence.fixture.js';

describe('current production game cumulative Evidence regression fixture', () => {
  it('contains all 41 historical questions and the approved first-trigger expectations', () => {
    expect(CURRENT_GAME_REGRESSION_ID).toBe('45419d5f-9953-4d7c-a478-4963138e9c96');
    expect(CURRENT_GAME_REGRESSION_QUESTIONS).toHaveLength(41);
    expect(CURRENT_GAME_REGRESSION_QUESTIONS.map(({ sequenceNo }) => sequenceNo)).toEqual([
      ...Array.from({ length: 12 }, (_, index) => index + 1),
      ...Array.from({ length: 29 }, (_, index) => index + 14),
    ]);

    const progress = rebuildEvidenceProgress(CURRENT_GAME_REGRESSION_KEY_POINTS, regressionJudgments());
    expect(progress.discoveredCount).toBe(3);
    expect(progress.claims).toEqual([
      { keyPointId: 'kp-1', messageId: 'message-10', playerId: 'player-b' },
      { keyPointId: 'kp-2', messageId: 'message-35', playerId: 'player-b' },
      { keyPointId: 'kp-3', messageId: 'message-41', playerId: 'player-b' },
    ]);
    expect(progress.messages.filter(({ awardedPoints }) => awardedPoints > 0).map(({ messageId, discoveredKeyPointIds }) => ({ messageId, discoveredKeyPointIds }))).toEqual([
      { messageId: 'message-10', discoveredKeyPointIds: ['kp-1'] },
      { messageId: 'message-35', discoveredKeyPointIds: ['kp-2'] },
      { messageId: 'message-41', discoveredKeyPointIds: ['kp-3'] },
    ]);
  });
});
