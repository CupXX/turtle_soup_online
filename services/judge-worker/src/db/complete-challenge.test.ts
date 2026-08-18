import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { completeChallenge } from './complete-challenge.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000002';
const challengeId = '00000000-0000-4000-8000-000000000003';
const messageId = '00000000-0000-4000-8000-000000000004';
const playerId = '00000000-0000-4000-8000-000000000005';
const keyPointOne = '00000000-0000-4000-8000-000000000006';
const keyPointTwo = '00000000-0000-4000-8000-000000000007';
const keyPointThree = '00000000-0000-4000-8000-000000000008';

const freshJudgments = [
  { slot: 1, verdict: 'NO' as const, coveredKeyPointIds: [] },
  { slot: 2, verdict: 'BOTH' as const, coveredKeyPointIds: [] },
  { slot: 3, verdict: 'IRRELEVANT' as const, coveredKeyPointIds: [] },
  { slot: 4, verdict: 'YES' as const, coveredKeyPointIds: [] },
];

type ChallengeFakeOptions = {
  messageSequenceNo?: number;
  judgedCount?: number;
  boundarySequenceNos?: number[];
};

function fakeTransaction(options: ChallengeFakeOptions = {}) {
  const calls: string[] = [];
  const transaction = async <T>(callback: (sql: TransactionSql) => Promise<T>): Promise<T> => {
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((text, chunk, index) => `${text}${chunk}${index < values.length ? String(values[index]) : ''}`, '');
      calls.push(query);
      const normalized = query.toLowerCase();
      if (normalized.includes('from private.game_actions')) return Promise.resolve([{
        id: actionId, gameId, playerId, actionType: 'CHALLENGE', status: 'PROCESSING',
        leaseOwner: 'worker-1', leaseExpiresAt: '2099-01-01T00:00:00.000Z', resultResourceId: challengeId,
      }] as never);
      if (normalized.includes('from api.games')) return Promise.resolve([{ id: gameId, status: 'ACTIVE' }] as never);
      if (normalized.includes('from private.message_challenges')) return Promise.resolve([{ id: challengeId, messageId, gameId, status: 'PENDING' }] as never);
      if (normalized.includes('count(*)::int as count')) return Promise.resolve([{ count: options.judgedCount ?? 0 }] as never);
      if (normalized.includes('from api.messages') && normalized.includes('content as question')) {
        const sequenceNos = options.boundarySequenceNos ?? [];
        return Promise.resolve(sequenceNos.map((sequenceNo) => ({ sequence_no: sequenceNo, question: `问题${sequenceNo}`, verdict: 'YES' })) as never);
      }
      if (normalized.includes('from api.messages') && normalized.includes('challenge_status')) return Promise.resolve([{ id: messageId, gameId, playerId, sequenceNo: options.messageSequenceNo ?? 4, status: 'JUDGED', challengeStatus: 'PENDING', awardedPoints: 1 }] as never);
      if (normalized.includes('from private.question_judgments') && normalized.includes('original_verdict')) return Promise.resolve([{ messageId, currentVerdict: 'YES', currentCoveredKeyPointIds: [keyPointOne] }] as never);
      if (normalized.includes('from private.key_points')) return Promise.resolve([{ id: keyPointOne }, { id: keyPointTwo }, { id: keyPointThree }] as never);
      if (normalized.includes('coalesce(sum(awarded_points)')) return Promise.resolve([{ playerId, points: 1 }] as never);
      if (normalized.includes('from private.question_judgments judgments')) return Promise.resolve([{ messageId, currentVerdict: 'BOTH', currentCoveredKeyPointIds: [], playerId, sequenceNo: 4, messageStatus: 'JUDGED' }] as never);
      if (normalized.includes('returning key_point_id')) return Promise.resolve([] as never);
      return Promise.resolve([] as never);
    }) as unknown as TransactionSql;
    return callback(sql);
  };
  return { calls, transaction };
}

describe('completeChallenge', () => {
  it('reconciles the final verdict, claims, score, hit rate, and public challenge state in one transaction', async () => {
    const fake = fakeTransaction();
    await completeChallenge({ actionId, workerId: 'worker-1', challengeId, freshJudgments }, { transaction: fake.transaction });

    const query = fake.calls.join('\n').toLowerCase();
    expect(query).toContain('from private.game_actions');
    expect(query).toContain('for update');
    expect(query).toContain('update private.question_judgments');
    expect(query).toContain('current_verdict = both');
    expect(query).toContain('delete from private.key_point_claims');
    expect(query).toContain('discovered_key_point_count = 0');
    expect(query).toContain('update api.game_player_stats');
    expect(query).toContain('yes_count');
    expect(query).toContain("status = 'resolved'");
    expect(query).toContain("challenge_status = 'resolved'");
    expect(query).toContain('challenge_outcome = success');
    expect(query).toContain("status = 'completed'");
  });

  it('records an upheld outcome when the fresh judgment matches the original judgment', async () => {
    const fake = fakeTransaction();
    const scheduled: number[] = [];
    const matchingJudgments = [1, 2, 3, 4].map((slot) => ({
      slot,
      verdict: 'YES' as const,
      coveredKeyPointIds: [keyPointOne],
    }));

    await completeChallenge({ actionId, workerId: 'worker-1', challengeId, freshJudgments: matchingJudgments }, {
      transaction: fake.transaction,
      scheduleProgressSummary: async (_sql, _gameId, boundary) => { scheduled.push(boundary); },
    });

    expect(fake.calls.join('\n').toLowerCase()).toContain('challenge_outcome = upheld');
    expect(scheduled).toHaveLength(0);
  });

  it.each([
    [7, 10, 10, 1],
    [14, 14, 10, 0],
    [17, 23, 20, 1],
  ])('refreshes only when a changed challenge message is inside the latest boundary (question %s)', async (messageSequenceNo, judgedCount, boundary, expectedCalls) => {
    const fake = fakeTransaction({
      messageSequenceNo,
      judgedCount,
      boundarySequenceNos: Array.from({ length: boundary }, (_, index) => index + 1),
    });
    const scheduled: number[] = [];

    await completeChallenge({ actionId, workerId: 'worker-1', challengeId, freshJudgments }, {
      transaction: fake.transaction,
      scheduleProgressSummary: async (_sql, _gameId, scheduledBoundary) => { scheduled.push(scheduledBoundary); },
    });

    expect(scheduled).toEqual(expectedCalls ? [boundary] : []);
  });

  it('refuses to start an incomplete four-vote reconciliation', async () => {
    const fake = fakeTransaction();
    await expect(completeChallenge({ actionId, workerId: 'worker-1', challengeId, freshJudgments: freshJudgments.slice(0, 3) }, { transaction: fake.transaction }))
      .rejects.toThrow('INCOMPLETE_CHALLENGE_JUDGMENTS');
    expect(fake.calls).toHaveLength(0);
  });
});
