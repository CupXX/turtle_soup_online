import { createHmac } from 'node:crypto';
import { getDb } from '@/server/db/client';

export type RateLimitInput = {
  bucket: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export type RateWindow = { count: number; resetAt: Date };

export type RateLimitStore = {
  increment(input: RateLimitInput & { now: Date }): Promise<RateWindow>;
};

export function hashRateLimitKey(rawKey: string, secret: string): string {
  return createHmac('sha256', secret).update(rawKey.trim()).digest('hex');
}

const databaseStore: RateLimitStore = {
  async increment(input) {
    const now = input.now;
    const resetAt = new Date(now.getTime() + input.windowSeconds * 1000);
    const rows = await getDb()<Array<{ count: number; resetAt: Date }>>`
      insert into private.rate_limit_buckets
        (bucket_key, window_started_at, count, expires_at)
      values (${input.bucket}, ${now}, 1, ${resetAt})
      on conflict (bucket_key) do update
        set count = case
          when private.rate_limit_buckets.expires_at <= ${now}
            then 1
          else private.rate_limit_buckets.count + 1
        end,
        window_started_at = case
          when private.rate_limit_buckets.expires_at <= ${now}
            then ${now}
          else private.rate_limit_buckets.window_started_at
        end,
        expires_at = case
          when private.rate_limit_buckets.expires_at <= ${now}
            then ${resetAt}
          else private.rate_limit_buckets.expires_at
        end
      returning count, expires_at as "resetAt"
    `;
    return rows[0] ?? { count: 1, resetAt };
  },
};

export async function consumeRateLimit(
  input: RateLimitInput,
  dependencies: { store?: RateLimitStore; now?: Date } = {},
): Promise<RateLimitResult> {
  if (!Number.isInteger(input.limit) || input.limit <= 0 || !Number.isInteger(input.windowSeconds) || input.windowSeconds <= 0) {
    throw new Error('Invalid rate-limit configuration');
  }

  const now = dependencies.now ?? new Date();
  const window = await (dependencies.store ?? databaseStore).increment({ ...input, now });
  const resetAt = window.resetAt instanceof Date ? window.resetAt : new Date(window.resetAt);
  if (window.count > input.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
    };
  }

  return { allowed: true, remaining: Math.max(0, input.limit - window.count) };
}
