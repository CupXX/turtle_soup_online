import { describe, expect, it } from 'vitest';
import { rebuildEvidenceProgress } from './key-point-progress.js';

const keyPoints = [
  { id: 'kp-1', requiredEvidenceIds: ['e-1', 'e-2'] },
  { id: 'kp-2', requiredEvidenceIds: ['e-3', 'e-4'] },
];

describe('rebuildEvidenceProgress', () => {
  it('completes a milestone when the final evidence arrives on a later player message', () => {
    const result = rebuildEvidenceProgress(keyPoints, [
      { messageId: 'm-1', playerId: 'player-a', sequenceNo: 1, establishedEvidenceIds: ['e-1'] },
      { messageId: 'm-2', playerId: 'player-b', sequenceNo: 2, establishedEvidenceIds: ['e-2'] },
    ]);

    expect(result.claims).toEqual([
      { keyPointId: 'kp-1', messageId: 'm-2', playerId: 'player-b' },
    ]);
    expect(result.messages).toEqual([
      { messageId: 'm-1', playerId: 'player-a', discoveredKeyPointIds: [], awardedPoints: 0 },
      { messageId: 'm-2', playerId: 'player-b', discoveredKeyPointIds: ['kp-1'], awardedPoints: 1 },
    ]);
    expect(result.awardsByPlayer).toEqual({ 'player-b': 1 });
    expect(result.discoveredCount).toBe(1);
  });

  it('awards each key point once and handles two completions on one message', () => {
    const result = rebuildEvidenceProgress(keyPoints, [
      { messageId: 'm-3', playerId: 'player-a', sequenceNo: 3, establishedEvidenceIds: ['e-1', 'e-3'] },
      { messageId: 'm-4', playerId: 'player-a', sequenceNo: 4, establishedEvidenceIds: ['e-2', 'e-4'] },
      { messageId: 'm-5', playerId: 'player-b', sequenceNo: 5, establishedEvidenceIds: ['e-1', 'e-2', 'e-3', 'e-4'] },
    ]);

    expect(result.claims).toEqual([
      { keyPointId: 'kp-1', messageId: 'm-4', playerId: 'player-a' },
      { keyPointId: 'kp-2', messageId: 'm-4', playerId: 'player-a' },
    ]);
    expect(result.messages).toEqual([
      { messageId: 'm-3', playerId: 'player-a', discoveredKeyPointIds: [], awardedPoints: 0 },
      { messageId: 'm-4', playerId: 'player-a', discoveredKeyPointIds: ['kp-1', 'kp-2'], awardedPoints: 2 },
      { messageId: 'm-5', playerId: 'player-b', discoveredKeyPointIds: [], awardedPoints: 0 },
    ]);
    expect(result.awardsByPlayer).toEqual({ 'player-a': 2 });
    expect(result.discoveredCount).toBe(2);
  });

  it('rebuilds challenge changes instead of preserving stale claims', () => {
    const result = rebuildEvidenceProgress(keyPoints, [
      { messageId: 'm-1', playerId: 'player-a', sequenceNo: 1, establishedEvidenceIds: ['e-1'] },
      { messageId: 'm-2', playerId: 'player-b', sequenceNo: 2, establishedEvidenceIds: [] },
      { messageId: 'm-3', playerId: 'player-a', sequenceNo: 3, establishedEvidenceIds: ['e-2'] },
      { messageId: 'm-4', playerId: 'player-b', sequenceNo: 4, establishedEvidenceIds: ['e-3', 'e-4'] },
    ]);

    expect(result.claims).toEqual([
      { keyPointId: 'kp-1', messageId: 'm-3', playerId: 'player-a' },
      { keyPointId: 'kp-2', messageId: 'm-4', playerId: 'player-b' },
    ]);
    expect(result.messages.map(({ messageId, discoveredKeyPointIds }) => ({ messageId, discoveredKeyPointIds }))).toEqual([
      { messageId: 'm-1', discoveredKeyPointIds: [] },
      { messageId: 'm-2', discoveredKeyPointIds: [] },
      { messageId: 'm-3', discoveredKeyPointIds: ['kp-1'] },
      { messageId: 'm-4', discoveredKeyPointIds: ['kp-2'] },
    ]);
  });

  it('rejects duplicate or unknown evidence IDs', () => {
    expect(() => rebuildEvidenceProgress(keyPoints, [
      { messageId: 'm-1', playerId: 'player-a', sequenceNo: 1, establishedEvidenceIds: ['e-1', 'e-1'] },
    ])).toThrow('DUPLICATE_EVIDENCE_ID');
    expect(() => rebuildEvidenceProgress(keyPoints, [
      { messageId: 'm-1', playerId: 'player-a', sequenceNo: 1, establishedEvidenceIds: ['e-unknown'] },
    ])).toThrow('UNKNOWN_EVIDENCE_ID');
  });
});
