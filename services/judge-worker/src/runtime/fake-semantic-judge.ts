import type {
  FinalAnswerJudgeResult,
  KeyPointExtractionResult,
  ProgressSummaryResult,
  QuestionJudgeResult,
  SemanticJudge,
} from '@turtle-soup/contracts';

export type FakeSemanticJudgeResponses = {
  extraction?: KeyPointExtractionResult;
  question?: QuestionJudgeResult;
  finalAnswer?: FinalAnswerJudgeResult;
  progressSummary?: ProgressSummaryResult;
};

export class FakeSemanticJudge implements SemanticJudge {
  constructor(private readonly responses: FakeSemanticJudgeResponses = {}) {}

  async extractKeyPoints(): Promise<KeyPointExtractionResult> {
    return this.responses.extraction ?? {
      key_points: [
        { content: 'fake key point one', evidence: [{ content: 'fake evidence one' }] },
        { content: 'fake key point two', evidence: [{ content: 'fake evidence two' }] },
        { content: 'fake key point three', evidence: [{ content: 'fake evidence three' }] },
      ],
    };
  }

  async judgeQuestion(): Promise<QuestionJudgeResult> {
    return this.responses.question ?? { verdict: 'IRRELEVANT', fully_covered_key_point_ids: [] };
  }

  async judgeFinalAnswer(): Promise<FinalAnswerJudgeResult> {
    return this.responses.finalAnswer ?? { covered_key_point_ids: [] };
  }

  async summarizeProgress(): Promise<ProgressSummaryResult> {
    return this.responses.progressSummary ?? { confirmed_facts: [], ruled_out_facts: [], irrelevant_topics: [] };
  }
}
