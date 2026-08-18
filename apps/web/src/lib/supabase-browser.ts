'use client';

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { ConnectionStatus, RealtimeSubscribe, RealtimeSubscription } from '@/hooks/use-game-realtime';

type BrowserSupabase = SupabaseClient;

export function createBrowserSupabase(): BrowserSupabase | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return null;
  }

  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function toConnectionStatus(status: string): ConnectionStatus {
  if (status === 'SUBSCRIBED' || status === 'JOINED') return 'CONNECTED';
  if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') return 'OFFLINE';
  return 'RECONNECTING';
}

function subscribeToPublicTables(client: BrowserSupabase, gameId: string, onInvalidate: () => void, onStatus: (status: ConnectionStatus) => void): RealtimeSubscription {
  const channel: RealtimeChannel = client
    .channel(`public-game-${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'api', table: 'games', filter: `id=eq.${gameId}` }, onInvalidate)
    .on('postgres_changes', { event: '*', schema: 'api', table: 'messages', filter: `game_id=eq.${gameId}` }, onInvalidate)
    .on('postgres_changes', { event: '*', schema: 'api', table: 'game_events', filter: `game_id=eq.${gameId}` }, onInvalidate)
    .on('postgres_changes', { event: '*', schema: 'api', table: 'game_player_stats', filter: `game_id=eq.${gameId}` }, onInvalidate)
    .on('postgres_changes', { event: '*', schema: 'api', table: 'game_progress_summaries', filter: `game_id=eq.${gameId}` }, onInvalidate)
    .subscribe((status) => onStatus(toConnectionStatus(status)));

  return {
    unsubscribe: () => {
      void client.removeChannel(channel);
    },
  };
}

export function createRealtimeSubscribe(client: BrowserSupabase | null): RealtimeSubscribe | undefined {
  if (!client) return undefined;
  return (gameId, onInvalidate, onStatus) => subscribeToPublicTables(client, gameId, onInvalidate, onStatus);
}
