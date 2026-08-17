import { randomUUID } from 'node:crypto';
import type { JudgeVerdict } from '@turtle-soup/contracts';
import type { Sql } from 'postgres';
import type { SkillRuntimeMetadata } from '../runtime/create-semantic-judge.js';
import { getWorkerDb } from './client.js';

export type ChallengeJudgmentRecord = {
  challengeId: string;
  slot: number;
  metadata: SkillRuntimeMetadata;
  verdict: JudgeVerdict | null;
  coveredKeyPointIds: string[];
  establishedEvidenceIds?: string[];
  valid: boolean;
  errorCode: string | null;
  latencyMs: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

export type ChallengeJudgmentDependencies = {
  sql?: Sql;
  idFactory?: () => string;
};

export async function recordChallengeJudgment(
  input: ChallengeJudgmentRecord,
  dependencies: ChallengeJudgmentDependencies = {},
): Promise<void> {
  if (!Number.isInteger(input.slot) || input.slot < 1 || input.slot > 4) throw new Error('INVALID_CHALLENGE_SLOT');
  const sql = dependencies.sql ?? getWorkerDb();
  const id = (dependencies.idFactory ?? randomUUID)();
  await sql`
    insert into private.challenge_judgments
      (
        id,
        challenge_id,
        slot,
        provider,
        model,
        reasoning_effort,
        prompt_version,
        schema_version,
        verdict,
        covered_key_point_ids,
        established_evidence_ids,
        valid,
        error_code,
        latency_ms,
        input_tokens,
        output_tokens,
        created_at
      )
    values
      (
        ${id},
        ${input.challengeId},
        ${input.slot},
        ${input.metadata.provider},
        ${input.metadata.model},
        ${input.metadata.reasoningEffort},
        ${input.metadata.promptVersion},
        ${input.metadata.schemaVersion},
        ${input.verdict},
        ${input.coveredKeyPointIds}::uuid[],
        ${input.establishedEvidenceIds ?? []}::uuid[],
        ${input.valid},
        ${input.errorCode},
        ${input.latencyMs},
        ${input.inputTokens ?? null},
        ${input.outputTokens ?? null},
        now()
      )
    on conflict (challenge_id, slot) do update
      set provider = excluded.provider,
          model = excluded.model,
          reasoning_effort = excluded.reasoning_effort,
          prompt_version = excluded.prompt_version,
          schema_version = excluded.schema_version,
          verdict = excluded.verdict,
          covered_key_point_ids = excluded.covered_key_point_ids,
          established_evidence_ids = excluded.established_evidence_ids,
          valid = excluded.valid,
          error_code = excluded.error_code,
          latency_ms = excluded.latency_ms,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens
  `;
}
