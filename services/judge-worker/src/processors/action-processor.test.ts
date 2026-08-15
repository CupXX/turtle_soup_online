import { describe, expect, it } from 'vitest';
import { JudgeValidationError } from '../skills/validate-result.js';
import { SemanticJudgeRuntimeError } from '../runtime/semantic-judge.js';
import type { ClaimedAction } from '../db/queue.js';
import { processClaimedAction } from './action-processor.js';
import type { ClaimedChallengeAction } from './challenge-processor.js';

const action: ClaimedAction = {
  id: '00000000-0000-4000-8000-000000000001',
  gameId: '00000000-0000-4000-8000-000000000002',
  playerId: '00000000-0000-4000-8000-000000000003',
  sequenceNo: 1,
  actionType: 'NORMAL_MESSAGE',
  attempt: 2,
  leaseOwner: 'worker-1',
  leaseExpiresAt: '2099-01-01T00:00:00.000Z',
};

function dependencies(processQuestion: () => Promise<void>, processFinalAnswer: () => Promise<void> = async () => undefined, processChallenge: () => Promise<void> = async () => undefined) {
  const retries: Array<{ code: string; id: string; attempt: number }> = [];
  const blocks: Array<{ code: string; id: string }> = [];
  return {
    retries,
    blocks,
    value: {
      judge: {} as never,
      workerId: 'worker-1',
      now: new Date('2026-08-15T00:00:00.000Z'),
      processQuestion,
      processFinalAnswer,
      processChallenge: async () => processChallenge(),
      recordRetry: async (id: string, attempt: number, code: string) => { retries.push({ id, attempt, code }); },
      markBlocked: async (id: string, code: string) => { blocks.push({ id, code }); },
    },
  };
}

describe('processClaimedAction', () => {
  it('dispatches NORMAL_MESSAGE to question judging and does not retry success', async () => {
    let processed = 0;
    const fake = dependencies(async () => { processed += 1; });

    await processClaimedAction(action, fake.value);

    expect(processed).toBe(1);
    expect(fake.retries).toEqual([]);
    expect(fake.blocks).toEqual([]);
  });

  it('maps timeout and transport failures to action retry backoff', async () => {
    for (const error of [
      new SemanticJudgeRuntimeError('TIMEOUT', 'slow'),
      new SemanticJudgeRuntimeError('TRANSPORT_ERROR', 'offline'),
    ]) {
      const fake = dependencies(async () => { throw error; });

      await processClaimedAction(action, fake.value);

      expect(fake.retries).toEqual([{ id: action.id, attempt: action.attempt, code: error.code }]);
    }
  });

  it('maps validation failures to action retry backoff', async () => {
    const fake = dependencies(async () => {
      throw new JudgeValidationError('SCHEMA_INVALID', 'invalid shape');
    });

    await processClaimedAction(action, fake.value);

    expect(fake.retries).toEqual([{ id: action.id, attempt: action.attempt, code: 'SCHEMA_INVALID' }]);
  });

  it('does not retry a lease that was already lost before dispatch', async () => {
    let processed = 0;
    const fake = dependencies(async () => { processed += 1; });

    await processClaimedAction({ ...action, leaseExpiresAt: '2020-01-01T00:00:00.000Z' }, fake.value);

    expect(processed).toBe(0);
    expect(fake.retries).toEqual([]);
    expect(fake.blocks).toEqual([]);
  });

  it('does not retry when the question processor reports a lost lease', async () => {
    const fake = dependencies(async () => { throw new Error('LEASE_LOST'); });

    await processClaimedAction(action, fake.value);

    expect(fake.retries).toEqual([]);
    expect(fake.blocks).toEqual([]);
  });

  it('dispatches FINAL_ANSWER to final-answer judging', async () => {
    let processed = 0;
    const fake = dependencies(async () => undefined, async () => { processed += 1; });

    await processClaimedAction({ ...action, actionType: 'FINAL_ANSWER' }, fake.value);

    expect(processed).toBe(1);
  });

  it('dispatches CHALLENGE to the independent-vote processor', async () => {
    let processed = 0;
    const fake = dependencies(async () => undefined, async () => undefined, async () => { processed += 1; });

    await processClaimedAction({ ...action, actionType: 'CHALLENGE' } as ClaimedChallengeAction, fake.value);

    expect(processed).toBe(1);
  });
});
