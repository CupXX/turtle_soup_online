// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  channel: {
    on: vi.fn(),
    subscribe: vi.fn(),
  },
  client: {
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

mocks.channel.on.mockReturnValue(mocks.channel);
mocks.channel.subscribe.mockReturnValue(mocks.channel);
mocks.client.channel.mockReturnValue(mocks.channel);

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mocks.client),
}));

import { createBrowserSupabase, createRealtimeSubscribe } from './supabase-browser';

describe('public game realtime subscriptions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.channel.on.mockClear();
    mocks.channel.subscribe.mockClear();
  });

  it('invalidates snapshots when the public progress summary changes for this game', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
    const invalidate = vi.fn();
    const subscribe = createRealtimeSubscribe(createBrowserSupabase());

    subscribe?.('game-1', invalidate, vi.fn());

    expect(mocks.channel.on).toHaveBeenCalledWith('postgres_changes', {
      event: '*',
      schema: 'api',
      table: 'game_progress_summaries',
      filter: 'game_id=eq.game-1',
    }, invalidate);
  });
});
