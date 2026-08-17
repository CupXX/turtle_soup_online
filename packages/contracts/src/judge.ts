export type KeyPointExtractionInput = {
  puzzle_surface: string;
  full_solution: string;
};

export type KeyPointExtractionResult = {
  key_points: Array<{
    content: string;
    evidence: Array<{ content: string }>;
  }>;
};

export type JudgeEvidence = {
  id: string;
  content: string;
};

export type JudgeKeyPoint = {
  id: string;
  content: string;
  evidence?: JudgeEvidence[];
};

export type QuestionJudgeInput = {
  puzzle_surface: string;
  full_solution: string;
  key_points: JudgeKeyPoint[];
  current_message: string;
};

export type LegacyQuestionJudgeResult = {
  verdict: JudgeVerdict;
  fully_covered_key_point_ids: string[];
};

export type EvidenceQuestionJudgeResult = {
  verdict: JudgeVerdict;
  established_evidence_ids: string[];
};

export type QuestionJudgeResult = LegacyQuestionJudgeResult | EvidenceQuestionJudgeResult;

export type FinalAnswerJudgeInput = {
  key_points: JudgeKeyPoint[];
  final_answer: string;
};

export type FinalAnswerJudgeResult = {
  covered_key_point_ids: string[];
};

export type JudgeErrorCode =
  | 'TRANSPORT_ERROR'
  | 'TIMEOUT'
  | 'EMPTY_RESPONSE'
  | 'INVALID_JSON'
  | 'SCHEMA_INVALID'
  | 'UNKNOWN_KEY_POINT_ID'
  | 'UNKNOWN_EVIDENCE_ID'
  | 'LEASE_LOST';

export interface SemanticJudge {
  extractKeyPoints(input: KeyPointExtractionInput): Promise<KeyPointExtractionResult>;
  judgeQuestion(input: QuestionJudgeInput): Promise<QuestionJudgeResult>;
  judgeFinalAnswer(input: FinalAnswerJudgeInput): Promise<FinalAnswerJudgeResult>;
}
import type { JudgeVerdict } from './game.js';
