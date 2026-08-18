import type { JudgeErrorCode, SemanticJudge } from '@turtle-soup/contracts';

export type HarnessSkill = 'key-point-extraction' | 'question-judge' | 'final-answer-judge' | 'progress-summary';

export type HarnessInvocation = {
  skill: HarnessSkill;
  prompt: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
};

export type HarnessInvoker = (request: HarnessInvocation) => Promise<unknown>;

export class SemanticJudgeRuntimeError extends Error {
  constructor(public readonly code: Extract<JudgeErrorCode, 'TRANSPORT_ERROR' | 'TIMEOUT'>, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SemanticJudgeRuntimeError';
  }
}

export type { SemanticJudge };
