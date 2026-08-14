import type { ApiErrorCode } from '@turtle-soup/contracts';

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: '请求内容无效。',
  PLAYER_SESSION_REQUIRED: '需要玩家会话。',
  ADMIN_SESSION_REQUIRED: '需要管理员会话。',
  NO_CURRENT_GAME: '当前没有可用游戏。',
  GAME_NOT_ACTIVE: '游戏当前未进行中。',
  GAME_ALREADY_ACTIVE: '当前已有进行中的游戏。',
  JUDGE_UNAVAILABLE: '判定服务暂时不可用。',
  QUEUE_BLOCKED: '判定队列暂时阻塞。',
  RATE_LIMITED: '操作过于频繁，请稍后再试。',
  IDEMPOTENCY_CONFLICT: '请求标识已用于不同内容。',
  INTERNAL_ERROR: '服务器暂时无法完成请求。',
};

function jsonHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return headers;
}

export function ok<T>(data: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ data }), {
    ...init,
    headers: jsonHeaders(init.headers),
  });
}

export function apiError(code: ApiErrorCode, status: number, retryable = false): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message: ERROR_MESSAGES[code],
        retryable,
      },
    }),
    {
      status,
      headers: jsonHeaders(),
    },
  );
}
