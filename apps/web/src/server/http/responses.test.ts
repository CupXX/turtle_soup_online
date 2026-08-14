import { describe, expect, it } from 'vitest';
import { apiError, ok } from './responses.js';

describe('HTTP response helpers', () => {
  it('wraps successful data as JSON and preserves response options', async () => {
    const response = ok({ ready: true }, { status: 201, headers: { 'cache-control': 'no-store' } });

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ data: { ready: true } });
  });

  it('returns only a stable safe error body', async () => {
    const response = apiError('INTERNAL_ERROR', 500, true);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务器暂时无法完成请求。',
        retryable: true,
      },
    });
  });
});
