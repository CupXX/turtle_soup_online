// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameSnapshot } from '@turtle-soup/contracts';
import { useGameRealtime, type RealtimeSubscription } from './use-game-realtime';

const snapshot = { game: { id: 'game-1' } } as PublicGameSnapshot;
const nextSnapshot = { game: { id: 'game-1', status: 'ACTIVE' } } as PublicGameSnapshot;

afterEach(() => {
  vi.useRealTimers();
});

describe('useGameRealtime', () => {
  it('coalesces multiple invalidations into one snapshot refetch', async () => {
    vi.useFakeTimers();
    let invalidate = () => {};
    const fetchSnapshot = vi.fn().mockResolvedValue(nextSnapshot);
    const subscribe = vi.fn((_gameId: string, callback: () => void): RealtimeSubscription => {
      invalidate = callback;
      return { unsubscribe: vi.fn() };
    });
    const { result } = renderHook(() => useGameRealtime(snapshot, {
      gameId: 'game-1',
      fetchSnapshot,
      subscribe,
    }));

    act(() => {
      invalidate();
      invalidate();
      vi.advanceTimersByTime(99);
    });
    expect(fetchSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot).toBe(nextSnapshot);
  });

  it('refetches immediately on reconnect and polls while offline', async () => {
    vi.useFakeTimers();
    let status = (_value: 'CONNECTED' | 'RECONNECTING' | 'OFFLINE') => {};
    const fetchSnapshot = vi.fn().mockResolvedValue(nextSnapshot);
    const subscribe = vi.fn((_gameId: string, _invalidate: () => void, onStatus: typeof status) => {
      status = onStatus;
      return { unsubscribe: vi.fn() };
    });
    renderHook(() => useGameRealtime(snapshot, {
      gameId: 'game-1',
      fetchSnapshot,
      subscribe,
    }));

    await act(async () => {
      status('CONNECTED');
      await Promise.resolve();
    });
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      status('OFFLINE');
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes and clears timers on unmount', () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => ({ unsubscribe }));
    const { unmount } = renderHook(() => useGameRealtime(snapshot, {
      gameId: 'game-1',
      fetchSnapshot: vi.fn().mockResolvedValue(snapshot),
      subscribe,
    }));

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('starts realtime after an initially empty page receives its first snapshot', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot);
    const subscribe = vi.fn(() => ({ unsubscribe: vi.fn() }));
    const { result } = renderHook(() => useGameRealtime(null, { fetchSnapshot, subscribe }));

    await act(async () => {
      await result.current.refresh();
    });

    expect(subscribe).toHaveBeenCalledWith('game-1', expect.any(Function), expect.any(Function));
  });
});
