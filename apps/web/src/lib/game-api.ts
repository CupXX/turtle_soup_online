import type { ChallengeReceipt, PublicGameSnapshot, PublicMessage } from '@turtle-soup/contracts';

export type FinalAnswerReceipt = {
  submissionId: string;
  gameId: string;
  playerId: string;
  sequenceNo: number;
  status: 'PENDING';
};

export type PlayerSessionResponse = {
  playerId: string;
  displayNickname: string;
};

export type AdminStatusResponse = {
  gameId: string | null;
  gameStatus: 'WAITING' | 'ACTIVE' | 'ENDED' | null;
  extractionStatus: string | null;
  actionStatus: string | null;
  errorCode: string | null;
  workerHealthy: boolean;
  keyPoints: Array<{ ordinal: number; content: string }>;
};

type ApiEnvelope<T> = { data: T } | { error: { code?: string; message?: string; retryable?: boolean } };

export class GameApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'GameApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function idempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function jsonHeaders(withIdempotency = true): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (withIdempotency) headers.set('idempotency-key', idempotencyKey());
  return headers;
}

async function parseBody<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || !('data' in body)) {
    const error = 'error' in body ? body.error : undefined;
    throw new GameApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? '请求失败',
      error?.retryable ?? response.status >= 500,
    );
  }
  return body.data;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
  });
  return parseBody<T>(response);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
}

export function createPlayerSession(nickname: string): Promise<PlayerSessionResponse> {
  return postJson('/api/player-session', { nickname });
}

export function joinCurrentGame(): Promise<{ gameId: string }> {
  return postJson('/api/game/current/join', {});
}

export function postQuestion(content: string): Promise<PublicMessage> {
  return postJson('/api/game/current/messages', { content });
}

export function postChallenge(messageId: string): Promise<ChallengeReceipt> {
  return postJson('/api/game/current/messages/challenge', { messageId });
}

export function postFinalAnswer(answer: string): Promise<FinalAnswerReceipt> {
  return postJson('/api/game/current/final-answers', { answer });
}

export function fetchCurrentGame(): Promise<PublicGameSnapshot | null> {
  return request('/api/game/current', { cache: 'no-store' });
}

export function adminLogin(input: { nickname: string; secret: string }): Promise<{ nickname: string }> {
  return postJson('/api/admin/session', input);
}

export function createGame(input: { puzzleSurface: string; fullSolution: string }): Promise<{ gameId: string; status: 'WAITING' }> {
  return postJson('/api/admin/games', input);
}

export function replacePreparation(input: { puzzleSurface: string; fullSolution: string }): Promise<{ status: 'WAITING' }> {
  return request('/api/admin/games/current/preparation', {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
}

export function fetchAdminStatus(): Promise<AdminStatusResponse> {
  return request('/api/admin/status', { cache: 'no-store' });
}

export function retryExtraction(): Promise<{ status: 'RETRY' }> {
  return postJson('/api/admin/games/current/retry-extraction', {});
}

export function retryBlockedAction(): Promise<{ status: 'RETRY' }> {
  return postJson('/api/admin/games/current/retry-blocked-action', {});
}

export function forceEndGame(): Promise<{ status: 'ENDED'; endReason: 'FORCE_ENDED' }> {
  return postJson('/api/admin/games/current/force-end', { confirmation: 'FORCE_END' });
}
