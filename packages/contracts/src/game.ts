export type GameStatus = 'WAITING' | 'ACTIVE' | 'ENDED';

export type GameEndReason = 'FINAL_ANSWER_SUCCESS' | 'FORCE_ENDED';

export type PublicGameEventType =
  | 'FINAL_ANSWER_FAILED'
  | 'FINAL_ANSWER_SUCCEEDED'
  | 'FORCE_ENDED';

export type MessageStatus = 'PENDING' | 'JUDGED' | 'ERROR' | 'CANCELLED';

export type ChallengeStatus = 'NONE' | 'PENDING' | 'RESOLVED' | 'FAILED';

export type ChallengeOutcome = 'SUCCESS' | 'UPHELD';

export type JudgeVerdict = 'YES' | 'NO' | 'BOTH' | 'IRRELEVANT';

export type Timestamp = string;

export type ProgressSummaryGenerationStatus = 'PENDING' | 'READY' | 'ERROR';

export type PublicGameProgressSummary = {
  gameId: string;
  throughQuestionCount: number;
  throughSequenceNo: number;
  confirmedFacts: string[];
  ruledOutFacts: string[];
  irrelevantTopics: string[];
  generationStatus: ProgressSummaryGenerationStatus;
  targetQuestionCount: number | null;
  generatedAt: Timestamp | null;
  updatedAt: Timestamp;
};

export type PublicPlayer = {
  id: string;
  displayNickname: string;
  lifetimeScore: number;
  createdAt: Timestamp;
};

export type PublicGame = {
  id: string;
  status: GameStatus;
  puzzleSurface: string | null;
  keyPointTotal: number;
  discoveredKeyPointCount: number;
  totalQuestionCount: number;
  endReason: GameEndReason | null;
  winnerPlayerId: string | null;
  createdAt: Timestamp;
  activatedAt: Timestamp | null;
  endedAt: Timestamp | null;
  updatedAt: Timestamp;
};

export type PublicMessage = {
  id: string;
  gameId: string;
  playerId: string;
  sequenceNo: number;
  content: string;
  status: MessageStatus;
  /** Present on current API snapshots; optional for backwards-compatible demo/test fixtures. */
  challengeStatus?: ChallengeStatus;
  /** Present after a challenge resolves; optional for backwards-compatible fixtures. */
  challengeOutcome?: ChallengeOutcome | null;
  verdict: JudgeVerdict | null;
  awardedPoints: number;
  createdAt: Timestamp;
  judgedAt: Timestamp | null;
  updatedAt: Timestamp;
};

export type PublicGameEvent = {
  id: string;
  gameId: string;
  sequenceNo: number;
  eventType: PublicGameEventType;
  playerId: string | null;
  awardedPoints: number;
  createdAt: Timestamp;
};

export type PublicPlayerStats = {
  gameId: string;
  playerId: string;
  displayNickname: string;
  lifetimeScore: number;
  questionCount: number;
  yesCount: number;
  hitRate: number | null;
  updatedAt: Timestamp;
};

export type PublicRevealedKeyPoint = {
  ordinal: number;
  content: string;
};

export type PublicGameReveal = {
  fullSolution: string;
  revealedAt: Timestamp;
  keyPoints: PublicRevealedKeyPoint[];
};

export type PublicGameSnapshot = {
  game: PublicGame;
  players: PublicPlayer[];
  messages: PublicMessage[];
  events: PublicGameEvent[];
  stats: PublicPlayerStats[];
  reveal: PublicGameReveal | null;
  progressSummary: PublicGameProgressSummary | null;
};
