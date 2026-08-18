import type { SemanticJudge } from '@turtle-soup/contracts';
import { KEY_POINT_EXTRACTION_PROMPT_VERSION } from '../skills/key-point-extraction.js';
import { QUESTION_JUDGE_PROMPT_VERSION } from '../skills/question-judge.js';
import { FINAL_ANSWER_JUDGE_PROMPT_VERSION } from '../skills/final-answer-judge.js';
import { PROGRESS_SUMMARY_PROMPT_VERSION } from '../skills/progress-summary.js';
import { HarnessSemanticJudge } from './harness-semantic-judge.js';
import { createHarnessInvoker } from './create-harness-invoker.js';
import { OpenAIResponsesSemanticJudge } from './openai-responses-semantic-judge.js';
import type { HarnessSkill } from './semantic-judge.js';
import type { SkillJudgeConfig, WorkerConfig } from '../config.js';

export type SkillRuntimeMetadata = {
  provider: string;
  model: string;
  reasoningEffort: SkillJudgeConfig['reasoningEffort'];
  skillVersion: string;
  promptVersion: string;
  schemaVersion: 'judge-schema-v1' | 'judge-schema-v2';
};

export type JudgeRuntime = {
  judge: SemanticJudge;
  metadata: Record<HarnessSkill, SkillRuntimeMetadata>;
};

export type CreateSemanticJudgeDependencies = {
  createJudge?: (skill: HarnessSkill, selected: SkillJudgeConfig) => SemanticJudge;
  createOpenAIJudge?: (skill: HarnessSkill, selected: SkillJudgeConfig) => SemanticJudge;
};

const PROMPT_VERSIONS: Record<HarnessSkill, string> = {
  'key-point-extraction': KEY_POINT_EXTRACTION_PROMPT_VERSION,
  'question-judge': QUESTION_JUDGE_PROMPT_VERSION,
  'final-answer-judge': FINAL_ANSWER_JUDGE_PROMPT_VERSION,
  'progress-summary': PROGRESS_SUMMARY_PROMPT_VERSION,
};

const SKILLS: HarnessSkill[] = ['key-point-extraction', 'question-judge', 'final-answer-judge', 'progress-summary'];

export function createSemanticJudge(
  config: WorkerConfig,
  dependencies: CreateSemanticJudgeDependencies = {},
): JudgeRuntime {
  const createJudge = dependencies.createJudge ?? ((skill, selected) => {
    if (config.provider === 'openai-responses') {
      return (dependencies.createOpenAIJudge ?? (() => new OpenAIResponsesSemanticJudge({
        apiBaseUrl: config.apiBaseUrl,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
        model: selected.model,
        reasoningEffort: selected.reasoningEffort,
      })))(skill, selected);
    }
    return new HarnessSemanticJudge(
      createHarnessInvoker({
        apiBaseUrl: config.apiBaseUrl,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
        model: selected.model,
        reasoningEffort: selected.reasoningEffort,
      }),
      config.timeoutMs,
    );
  });

  const judges = Object.fromEntries(SKILLS.map((skill) => [skill, createJudge(skill, config.skillConfigs[skill])])) as Record<HarnessSkill, SemanticJudge>;
  const metadata = Object.fromEntries(SKILLS.map((skill) => {
    const selected = config.skillConfigs[skill];
    return [skill, {
      provider: config.provider,
      model: selected.model,
      reasoningEffort: selected.reasoningEffort,
      skillVersion: PROMPT_VERSIONS[skill],
      promptVersion: PROMPT_VERSIONS[skill],
      schemaVersion: 'judge-schema-v1' as const,
    }];
  })) as Record<HarnessSkill, SkillRuntimeMetadata>;

  return {
    judge: {
      extractKeyPoints: (input) => judges['key-point-extraction'].extractKeyPoints(input),
      judgeQuestion: (input) => judges['question-judge'].judgeQuestion(input),
      judgeFinalAnswer: (input) => judges['final-answer-judge'].judgeFinalAnswer(input),
      summarizeProgress: (input) => judges['progress-summary'].summarizeProgress(input),
    },
    metadata,
  };
}
