import type { JudgeVerdict } from '@turtle-soup/contracts';
import { loadWorkerConfig } from '../services/judge-worker/src/config.js';
import { getWorkerDb, withWorkerTransaction } from '../services/judge-worker/src/db/client.js';
import { rebuildEvidenceProgressInTransaction } from '../services/judge-worker/src/db/rebuild-evidence-progress.js';
import { createSemanticJudge } from '../services/judge-worker/src/runtime/create-semantic-judge.js';

const GAME_ID = process.argv[2];
const APPLY = process.argv.includes('--apply');
const ONLY = new Set((process.argv.find((argument) => argument.startsWith('--only='))?.slice('--only='.length) ?? '').split(',').filter(Boolean).map(Number));
if (!GAME_ID) throw new Error('usage: rejudge-game-evidence <game-id> [--apply]');

type KeyPointRow = { id: string; content: string; ordinal: number };
type EvidenceRow = { id: string; keyPointId: string; content: string; ordinal: number };
type MessageRow = { id: string; playerId: string; sequenceNo: number | string; content: string; verdict: JudgeVerdict; status: string };
type JudgmentRow = { messageId: string; currentVerdict: JudgeVerdict; originalVerdict: JudgeVerdict };

async function main(): Promise<void> {
const config = loadWorkerConfig();
const runtime = createSemanticJudge(config);
const db = getWorkerDb(config);

const [secrets, keyPoints, evidence, messages, judgments] = await Promise.all([
  db<{ puzzleSurface: string; fullSolution: string }[]>`
    select puzzle_surface as "puzzleSurface", full_solution as "fullSolution"
    from private.game_secrets where game_id = ${GAME_ID} order by input_version desc limit 1
  `,
  db<KeyPointRow[]>`
    select id, content, ordinal from private.key_points where game_id = ${GAME_ID} order by ordinal
  `,
  db<EvidenceRow[]>`
    select evidence.id, evidence.key_point_id as "keyPointId", evidence.content, evidence.ordinal
    from private.key_point_evidence evidence
    join private.key_points points on points.id = evidence.key_point_id
    where points.game_id = ${GAME_ID}
    order by points.ordinal, evidence.ordinal
  `,
  db<MessageRow[]>`
    select id, player_id as "playerId", sequence_no as "sequenceNo", content, verdict, status
    from api.messages where game_id = ${GAME_ID} and status = 'JUDGED' order by sequence_no
  `,
  db<JudgmentRow[]>`
    select message_id as "messageId", current_verdict as "currentVerdict", original_verdict as "originalVerdict"
    from private.question_judgments where game_id = ${GAME_ID}
  `,
]);

const secret = secrets[0];
if (!secret || keyPoints.length < 3 || evidence.length === 0) throw new Error('EVIDENCE_REJUDGE_INPUT_NOT_FOUND');
const evidenceByKeyPoint = new Map<string, EvidenceRow[]>();
for (const row of evidence) evidenceByKeyPoint.set(row.keyPointId, [...(evidenceByKeyPoint.get(row.keyPointId) ?? []), row]);
const questionInputBase = {
  puzzle_surface: secret.puzzleSurface,
  full_solution: secret.fullSolution,
  key_points: keyPoints.map(({ id, content }) => ({
    id,
    content,
    evidence: (evidenceByKeyPoint.get(id) ?? []).map(({ id: evidenceId, content: evidenceContent }) => ({ id: evidenceId, content: evidenceContent })),
  })),
};
const judgmentByMessage = new Map(judgments.map((row) => [row.messageId, row]));
const evaluations: Array<{ messageId: string; sequenceNo: number; verdict: JudgeVerdict; establishedEvidenceIds: string[]; modelVerdict: JudgeVerdict; mismatch: boolean }> = [];

for (const message of messages) {
  if (ONLY.size > 0 && !ONLY.has(Number(message.sequenceNo))) continue;
  const judgment = judgmentByMessage.get(message.id);
  if (!judgment) throw new Error(`MISSING_JUDGMENT:${message.id}`);
  const result = await runtime.judge.judgeQuestion({ ...questionInputBase, current_message: message.content });
  if (!('established_evidence_ids' in result)) throw new Error(`LEGACY_RESULT:${message.sequenceNo}`);
  const mismatch = result.verdict !== judgment.currentVerdict;
  evaluations.push({
    messageId: message.id,
    sequenceNo: Number(message.sequenceNo),
    verdict: judgment.currentVerdict,
    modelVerdict: result.verdict,
    establishedEvidenceIds: mismatch ? [] : result.established_evidence_ids,
    mismatch,
  });
  console.log(`sequence=${message.sequenceNo} verdict=${judgment.currentVerdict} model=${result.verdict} evidence=${mismatch ? 'discarded-on-verdict-mismatch' : JSON.stringify(result.established_evidence_ids)}`);
}

const mismatches = evaluations.filter(({ mismatch }) => mismatch);
if (!APPLY) {
  console.log(JSON.stringify({ gameId: GAME_ID, judged: evaluations.length, mismatches: mismatches.map(({ sequenceNo, verdict, modelVerdict }) => ({ sequenceNo, verdict, modelVerdict })) }, null, 2));
  await db.end();
  process.exit(0);
}

await withWorkerTransaction(async (sql) => {
  const games = await sql<{ id: string; status: string }[]>`
    select id, status from api.games where id = ${GAME_ID} for update
  `;
  if (games[0]?.status !== 'ACTIVE') throw new Error('GAME_NOT_ACTIVE');
  for (const evaluation of evaluations) {
    await sql`
      update private.question_judgments
      set original_established_evidence_ids = ${evaluation.establishedEvidenceIds}::uuid[],
          current_established_evidence_ids = ${evaluation.establishedEvidenceIds}::uuid[],
          original_covered_key_point_ids = '{}'::uuid[],
          current_covered_key_point_ids = '{}'::uuid[],
          prompt_version = 'question-judge-v7',
          schema_version = 'judge-schema-v2',
          updated_at = now()
      where message_id = ${evaluation.messageId} and game_id = ${GAME_ID}
    `;
  }
  await rebuildEvidenceProgressInTransaction(sql, GAME_ID);
  await sql`
    update private.question_judgments judgments
    set original_covered_key_point_ids = judgments.current_covered_key_point_ids,
        updated_at = now()
    where judgments.game_id = ${GAME_ID}
  `;
  await sql`
    update private.message_challenges challenges
    set resolved_established_evidence_ids = judgments.current_established_evidence_ids,
        resolved_covered_key_point_ids = judgments.current_covered_key_point_ids,
        updated_at = now()
    from private.question_judgments judgments
    where challenges.message_id = judgments.message_id
      and challenges.game_id = ${GAME_ID}
      and challenges.status = 'RESOLVED'
  `;
});

console.log(JSON.stringify({ gameId: GAME_ID, applied: true, judged: evaluations.length, mismatches: mismatches.map(({ sequenceNo, verdict, modelVerdict }) => ({ sequenceNo, verdict, modelVerdict })) }, null, 2));
await db.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
