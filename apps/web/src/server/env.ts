import { z } from 'zod';

const positiveInteger = z.coerce.number().int().positive();

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  GAME_WEB_DATABASE_URL: z
    .string()
    .regex(/^postgres(?:ql)?:\/\//, 'must be a PostgreSQL connection URL'),
  SITE_ORIGIN: z.string().url(),
  PLAYER_SESSION_SECRET: z.string().min(16),
  ADMIN_SESSION_SECRET: z.string().min(16),
  ADMIN_SECRET: z.string().min(16),
  IDEMPOTENCY_HMAC_SECRET: z.string().min(16),
  IP_HASH_SECRET: z.string().min(16),
  RATE_LIMIT_PLAYER_JOIN_PER_MINUTE: positiveInteger,
  RATE_LIMIT_MESSAGE_PER_PLAYER_PER_MINUTE: positiveInteger,
  RATE_LIMIT_MESSAGE_PER_IP_PER_MINUTE: positiveInteger,
  RATE_LIMIT_FINAL_ANSWER_PER_PLAYER_PER_5_MINUTES: positiveInteger,
  RATE_LIMIT_ADMIN_LOGIN_PER_IP_PER_15_MINUTES: positiveInteger,
  RATE_LIMIT_ADMIN_WRITE_PER_SESSION_PER_MINUTE: positiveInteger,
});

export type ServerEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  gameWebDatabaseUrl: string;
  siteOrigin: string;
  playerSessionSecret: string;
  adminSessionSecret: string;
  adminSecret: string;
  idempotencyHmacSecret: string;
  ipHashSecret: string;
  rateLimits: {
    playerJoinPerMinute: number;
    messagePerPlayerPerMinute: number;
    messagePerIpPerMinute: number;
    finalAnswerPerPlayerPerFiveMinutes: number;
    adminLoginPerIpPerFifteenMinutes: number;
    adminWritePerSessionPerMinute: number;
  };
};

function invalidConfigurationMessage(issues: z.ZodIssue[]): string {
  const fields = issues.map((issue) => issue.path.join('.') || 'environment').join(', ');
  return `Invalid server configuration: ${fields}`;
}

export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(invalidConfigurationMessage(parsed.error.issues));
  }

  const value = parsed.data;
  return {
    supabaseUrl: value.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: value.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    gameWebDatabaseUrl: value.GAME_WEB_DATABASE_URL,
    siteOrigin: value.SITE_ORIGIN,
    playerSessionSecret: value.PLAYER_SESSION_SECRET,
    adminSessionSecret: value.ADMIN_SESSION_SECRET,
    adminSecret: value.ADMIN_SECRET,
    idempotencyHmacSecret: value.IDEMPOTENCY_HMAC_SECRET,
    ipHashSecret: value.IP_HASH_SECRET,
    rateLimits: {
      playerJoinPerMinute: value.RATE_LIMIT_PLAYER_JOIN_PER_MINUTE,
      messagePerPlayerPerMinute: value.RATE_LIMIT_MESSAGE_PER_PLAYER_PER_MINUTE,
      messagePerIpPerMinute: value.RATE_LIMIT_MESSAGE_PER_IP_PER_MINUTE,
      finalAnswerPerPlayerPerFiveMinutes: value.RATE_LIMIT_FINAL_ANSWER_PER_PLAYER_PER_5_MINUTES,
      adminLoginPerIpPerFifteenMinutes: value.RATE_LIMIT_ADMIN_LOGIN_PER_IP_PER_15_MINUTES,
      adminWritePerSessionPerMinute: value.RATE_LIMIT_ADMIN_WRITE_PER_SESSION_PER_MINUTE,
    },
  };
}
