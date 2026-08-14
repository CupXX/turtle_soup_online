'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicGameSnapshot } from '@turtle-soup/contracts';

export type ConnectionStatus = 'CONNECTED' | 'RECONNECTING' | 'OFFLINE';

export type RealtimeSubscription = {
  unsubscribe: () => void;
};

export type RealtimeSubscribe = (
  gameId: string,
  onInvalidate: () => void,
  onStatus: (status: ConnectionStatus) => void,
) => RealtimeSubscription;

export type GameRealtimeOptions = {
  gameId?: string;
  fetchSnapshot?: () => Promise<PublicGameSnapshot | null>;
  subscribe?: RealtimeSubscribe;
};

export function useGameRealtime(
  initial: PublicGameSnapshot | null,
  options: GameRealtimeOptions = {},
): {
  snapshot: PublicGameSnapshot | null;
  connection: ConnectionStatus;
  refresh: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<PublicGameSnapshot | null>(initial);
  const [connection, setConnection] = useState<ConnectionStatus>('CONNECTED');
  const fetchRef = useRef(options.fetchSnapshot);
  const gameId = snapshot?.game.id ?? options.gameId;
  const subscribe = options.subscribe;

  useEffect(() => {
    fetchRef.current = options.fetchSnapshot;
  }, [options.fetchSnapshot]);

  const refresh = useCallback(async () => {
    if (!fetchRef.current) {
      return;
    }

    try {
      const next = await fetchRef.current();
      setSnapshot(next);
      setConnection('CONNECTED');
    } catch {
      setConnection('RECONNECTING');
    }
  }, []);

  useEffect(() => {
    if (!gameId || !subscribe) {
      return undefined;
    }

    let coalesceTimer: ReturnType<typeof setTimeout> | undefined;
    let offlineTimer: ReturnType<typeof setInterval> | undefined;
    let disposed = false;

    const refreshSafely = () => {
      if (!disposed) {
        void refresh();
      }
    };

    const scheduleRefresh = () => {
      if (coalesceTimer) {
        return;
      }
      coalesceTimer = setTimeout(() => {
        coalesceTimer = undefined;
        refreshSafely();
      }, 100);
    };

    const onStatus = (status: ConnectionStatus) => {
      setConnection(status);
      if (status === 'CONNECTED') {
        if (offlineTimer) {
          clearInterval(offlineTimer);
          offlineTimer = undefined;
        }
        refreshSafely();
      } else if (status === 'OFFLINE' && !offlineTimer) {
        offlineTimer = setInterval(refreshSafely, 5000);
      } else if (status === 'RECONNECTING' && offlineTimer) {
        clearInterval(offlineTimer);
        offlineTimer = undefined;
      }
    };

    const subscription = subscribe(gameId, scheduleRefresh, onStatus);
    return () => {
      disposed = true;
      if (coalesceTimer) {
        clearTimeout(coalesceTimer);
      }
      if (offlineTimer) {
        clearInterval(offlineTimer);
      }
      subscription.unsubscribe();
    };
  }, [gameId, refresh, subscribe]);

  return { snapshot, connection, refresh };
}
