import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type { HarnessSkill } from '../runtime/semantic-judge.js';
import type { SkillRuntimeMetadata } from '../runtime/create-semantic-judge.js';
import { getWorkerDb } from './client.js';

export type JudgeAttemptParent =
  | { actionId: string; extractionJobId?: never; attemptNo: number }
  | { extractionJobId: string; actionId?: never; attemptNo: number };

export type JudgeAttemptRecord = SkillRuntimeMetadata & {
  parent: JudgeAttemptParent;
  skill: HarnessSkill;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  resultValid: boolean;
  errorCode: string | null;
};

export type JudgeAttemptDependencies = {
  sql?: Sql;
  idFactory?: () => string;
};

export async function recordJudgeAttempt(
  input: JudgeAttemptRecord,
  dependencies: JudgeAttemptDependencies = {},
): Promise<void> {
  const sql = dependencies.sql ?? getWorkerDb();
  const id = (dependencies.idFactory ?? randomUUID)();
  const actionId = 'actionId' in input.parent ? (input.parent.actionId ?? null) : null;
  const extractionJobId = 'extractionJobId' in input.parent ? (input.parent.extractionJobId ?? null) : null;

  await sql`
    insert into private.judge_attempts
      (
        id,
        action_id,
        extraction_job_id,
        skill_type,
        provider,
        model,
        skill_version,
        prompt_version,
        schema_version,
        reasoning_effort,
        attempt_no,
        latency_ms,
        input_tokens,
        output_tokens,
        result_valid,
        error_code,
        created_at
      )
    values
      (
        ${id},
        ${actionId},
        ${extractionJobId},
        ${input.skill},
        ${input.provider},
        ${input.model},
        ${input.skillVersion},
        ${input.promptVersion},
        ${input.schemaVersion},
        ${input.reasoningEffort},
        ${input.parent.attemptNo},
        ${input.latencyMs},
        ${input.inputTokens},
        ${input.outputTokens},
        ${input.resultValid},
        ${input.errorCode},
        now()
      )
  `;
}
