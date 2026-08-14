import { cookies } from 'next/headers';
import { GameClient } from '@/components/game/game-client';
import { PLAYER_SESSION_COOKIE, readPlayerSession } from '@/server/auth/player-session';
import { getServerEnv } from '@/server/env';
import { getDb } from '@/server/db/client';
import { getCurrentSnapshot } from '@/server/game/get-current-snapshot';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const env = getServerEnv();
  const cookieStore = await cookies();
  const playerCookie = cookieStore.get(PLAYER_SESSION_COOKIE)?.value;
  const request = new Request(env.siteOrigin, {
    headers: playerCookie ? { cookie: `${PLAYER_SESSION_COOKIE}=${encodeURIComponent(playerCookie)}` } : undefined,
  });
  const playerId = readPlayerSession(request, env.playerSessionSecret);
  const snapshot = await getCurrentSnapshot(getDb(), playerId ?? undefined);

  return (
    <GameClient
      initialSnapshot={snapshot}
      currentPlayerId={playerId ?? undefined}
      requireNickname={!playerId}
    />
  );
}
