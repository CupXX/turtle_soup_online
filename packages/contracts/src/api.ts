import type {
  ChallengeStatus,
  GameEndReason,
  GameStatus,
  JudgeVerdict,
  MessageStatus,
  PublicGameEventType,
  PublicGameSnapshot,
} from './game.js';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'PLAYER_SESSION_REQUIRED'
  | 'ADMIN_SESSION_REQUIRED'
  | 'NO_CURRENT_GAME'
  | 'GAME_NOT_ACTIVE'
  | 'GAME_ALREADY_ACTIVE'
  | 'JUDGE_UNAVAILABLE'
  | 'QUEUE_BLOCKED'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MESSAGE_NOT_CHALLENGEABLE'
  | 'CHALLENGE_IN_PROGRESS'
  | 'CHALLENGE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
  };
};

export type ApiSuccess<T> = { data: T };

export type CurrentGameResponse = ApiSuccess<PublicGameSnapshot | null>;

export type ChallengeReceipt = {
  challengeId: string;
  messageId: string;
  status: ChallengeStatus;
};

export type PublicGameStatus = GameStatus;
export type PublicMessageStatus = MessageStatus;
export type PublicVerdict = JudgeVerdict;
export type PublicEventType = PublicGameEventType;
export type PublicEndReason = GameEndReason;
