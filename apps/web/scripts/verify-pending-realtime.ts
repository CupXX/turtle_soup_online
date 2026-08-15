import { randomUUID } from 'node:crypto';
import { createClient, type RealtimeChannel, type RealtimePostgresInsertPayload, type SupabaseClient } from '@supabase/supabase-js';

type CookieJar = { value: string };
type ApiEnvelope<T> = { data: T };

const siteOrigin = (process.env.SITE_ORIGIN ?? process.env.VERIFY_SITE_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function updateCookie(jar: CookieJar, response: Response): void {
  const header = response.headers.get('set-cookie');
  if (header) jar.value = header.split(';', 1)[0];
}

async function apiRequest<T>(path: string, options: { method?: string; jar?: CookieJar; body?: unknown } = {}): Promise<T> {
  const headers = new Headers({ origin: siteOrigin });
  if (options.jar?.value) headers.set('cookie', options.jar.value);
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    headers.set('idempotency-key', randomUUID());
  }
  const response = await fetch(`${siteOrigin}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (options.jar) updateCookie(options.jar, response);
  const envelope = await response.json() as ApiEnvelope<T> | { error?: { message?: string } };
  if (!response.ok || !('data' in envelope)) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return envelope.data;
}

function waitForPendingInsert(client: SupabaseClient<any, any, any>, gameId: string, playerId: string): {
  channel: RealtimeChannel;
  subscribed: Promise<void>;
  inserted: Promise<Record<string, unknown>>;
  dispose: () => void;
} {
  let resolveSubscribed!: () => void;
  let rejectSubscribed!: (error: Error) => void;
  let resolveInserted!: (row: Record<string, unknown>) => void;
  let rejectInserted!: (error: Error) => void;
  let settled = false;
  const subscribed = new Promise<void>((resolve, reject) => {
    resolveSubscribed = resolve;
    rejectSubscribed = reject;
  });
  const inserted = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveInserted = resolve;
    rejectInserted = reject;
  });
  const timeout = setTimeout(() => {
    const error = new Error('timed out waiting for the pending message INSERT event');
    if (!settled) rejectSubscribed(error);
    rejectInserted(error);
  }, 15_000);
  const channel = client
    .channel(`verify-pending-${randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'api', table: 'messages', filter: `game_id=eq.${gameId}` }, (payload: RealtimePostgresInsertPayload<Record<string, unknown>>) => {
      const row = payload.new;
      if (row.player_id === playerId) {
        settled = true;
        resolveInserted(row);
      }
    });
  channel.subscribe((status, error) => {
    if (status === 'SUBSCRIBED') resolveSubscribed();
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') rejectSubscribed(error ?? new Error(`realtime subscription ${status}`));
  });
  return {
    channel,
    subscribed,
    inserted,
    dispose: () => clearTimeout(timeout),
  };
}

async function main(): Promise<void> {
  assert(supabaseUrl && publishableKey, 'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required');
  const firstJar: CookieJar = { value: '' };
  const secondJar: CookieJar = { value: '' };
  const current = await apiRequest<{ game: { id: string; status: string } }>('/api/game/current');
  assert(current.game.status === 'ACTIVE', 'the current game must be ACTIVE');

  const suffix = Date.now().toString(36);
  const first = await apiRequest<{ playerId: string }>('/api/player-session', { method: 'POST', jar: firstJar, body: { nickname: `Realtime甲${suffix}` } });
  const second = await apiRequest<{ playerId: string }>('/api/player-session', { method: 'POST', jar: secondJar, body: { nickname: `Realtime乙${suffix}` } });
  await apiRequest('/api/game/current/join', { method: 'POST', jar: firstJar, body: {} });
  await apiRequest('/api/game/current/join', { method: 'POST', jar: secondJar, body: {} });

  const supabase = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const realtime = waitForPendingInsert(supabase, current.game.id, first.playerId);
  try {
    await realtime.subscribed;
    const receipt = await apiRequest<{ id: string; status: string; verdict: string | null }>('/api/game/current/messages', {
      method: 'POST',
      jar: firstJar,
      body: { content: `Realtime pending check ${suffix}` },
    });
    const inserted = await realtime.inserted;
    assert(inserted.id === receipt.id, 'realtime INSERT id did not match the API receipt');
    assert(inserted.status === 'PENDING', `realtime INSERT status was ${String(inserted.status)}`);
    assert(inserted.verdict === null, 'realtime INSERT unexpectedly contained a verdict');

    const secondSnapshot = await apiRequest<{ messages: Array<{ id: string; status: string; verdict: string | null }> }>('/api/game/current', { jar: secondJar });
    const visibleMessage = secondSnapshot.messages.find((message) => message.id === receipt.id);
    assert(visibleMessage, 'the second player snapshot did not contain the submitted message');
    assert(visibleMessage.status === 'PENDING', `second player saw status ${visibleMessage.status}`);
    assert(visibleMessage.verdict === null, 'second player saw a verdict before judgment');
    console.log('pending realtime verification passed');
  } finally {
    realtime.dispose();
    await supabase.removeChannel(realtime.channel);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'pending realtime verification failed');
  process.exitCode = 1;
});
