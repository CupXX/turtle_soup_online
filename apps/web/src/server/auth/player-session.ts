import { randomUUID } from 'node:crypto';
import type { ServerEnv } from '@/server/env';
import { withWebTransaction, type TransactionSql } from '@/server/db/client';
import { signSession, verifySession } from './session-token';

export const PLAYER_SESSION_COOKIE = 'turtle_soup_player';
export const PLAYER_SESSION_TTL_SECONDS = 365 * 24 * 60 * 60;

type PlayerSessionConfig = Pick<ServerEnv, 'playerSessionSecret' | 'siteOrigin'>;

export type PlayerIdentity = {
  id: string;
  displayNickname: string;
};

export type PlayerIdentityInput = {
  display: string;
  key: string;
};

export type PlayerIdentityStore = {
  findOrCreate(input: PlayerIdentityInput): Promise<PlayerIdentity>;
};

const databaseStore: PlayerIdentityStore = {
  async findOrCreate(input) {
    return withWebTransaction(async (sql: TransactionSql) => {
      const existing = await sql<Array<{ id: string; displayNickname: string }>>`
        select p.id, p.display_nickname as "displayNickname"
        from private.player_identities i
        join api.players p on p.id = i.player_id
        where i.nickname_key = ${input.key}
        limit 1
      `;
      if (existing[0]) {
        return existing[0];
      }

      const id = randomUUID();
      await sql`
        insert into api.players (id, display_nickname, lifetime_score, created_at, updated_at)
        values (${id}::uuid, ${input.display}, 0, now(), now())
      `;
      await sql`
        insert into private.player_identities (player_id, nickname_key)
        values (${id}::uuid, ${input.key})
        on conflict (nickname_key) do nothing
      `;

      const inserted = await sql<Array<{ id: string; displayNickname: string }>>`
        select p.id, p.display_nickname as "displayNickname"
        from private.player_identities i
        join api.players p on p.id = i.player_id
        where i.nickname_key = ${input.key}
        limit 1
      `;
      return inserted[0] ?? { id, displayNickname: input.display };
    });
  },
};

export function findOrCreatePlayer(
  input: PlayerIdentityInput,
  store: PlayerIdentityStore = databaseStore,
): Promise<PlayerIdentity> {
  return store.findOrCreate(input);
}

export function createPlayerSessionToken(
  playerId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  return signSession(
    {
      subject: playerId,
      kind: 'player',
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + PLAYER_SESSION_TTL_SECONDS,
    },
    secret,
    PLAYER_SESSION_TTL_SECONDS,
  );
}

function isSecureOrigin(siteOrigin: string): boolean {
  return new URL(siteOrigin).protocol === 'https:';
}

export function serializePlayerSessionCookie(
  playerId: string,
  config: PlayerSessionConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const secure = isSecureOrigin(config.siteOrigin) ? '; Secure' : '';
  const token = createPlayerSessionToken(playerId, config.playerSessionSecret, nowSeconds);
  return `${PLAYER_SESSION_COOKIE}=${token}; Path=/; Max-Age=${PLAYER_SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) {
    return null;
  }

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) {
      continue;
    }
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function readPlayerSession(request: Request, secret: string): string | null {
  const token = cookieValue(request, PLAYER_SESSION_COOKIE);
  const payload = token ? verifySession(token, secret) : null;
  return payload?.kind === 'player' ? payload.subject : null;
}
