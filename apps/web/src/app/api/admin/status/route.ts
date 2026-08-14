import { readAdminSession } from '@/server/auth/admin-session';
import { getDb } from '@/server/db/client';
import { getServerEnv } from '@/server/env';
import { getAdminStatus } from '@/server/game/admin-lifecycle';
import { apiError, ok } from '@/server/http/responses';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const env = getServerEnv();
    if (!readAdminSession(request, env.adminSessionSecret)) {
      return apiError('ADMIN_SESSION_REQUIRED', 401, false);
    }
    const response = ok(await getAdminStatus(getDb()));
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch {
    return apiError('INTERNAL_ERROR', 500, true);
  }
}
