import { getDb } from '@/server/db/client';
import { readPlayerSession } from '@/server/auth/player-session';
import { getServerEnv } from '@/server/env';
import { getCurrentSnapshot } from '@/server/game/get-current-snapshot';
import { apiError, ok } from '@/server/http/responses';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const env = getServerEnv();
    const playerId = readPlayerSession(request, env.playerSessionSecret) ?? undefined;
    const snapshot = await getCurrentSnapshot(getDb(), playerId);
    const response = ok(snapshot);
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch {
    return apiError('INTERNAL_ERROR', 500, true);
  }
}
