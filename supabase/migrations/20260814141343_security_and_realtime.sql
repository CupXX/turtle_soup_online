do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'game_web') then
    create role game_web nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'judge_worker') then
    create role judge_worker nologin noinherit;
  end if;
end
$$;

revoke all on schema api from public;
revoke all on schema private from public, anon, authenticated;
grant usage on schema api to anon, authenticated, game_web, judge_worker;
grant usage on schema private to game_web, judge_worker;

revoke all on all tables in schema api from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema api from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

grant select on table
  api.players,
  api.games,
  api.messages,
  api.game_events,
  api.game_player_stats,
  api.game_reveals,
  api.revealed_key_points
to anon, authenticated;

grant select, insert, update on table
  api.players,
  api.games,
  api.messages,
  api.game_events,
  api.game_player_stats,
  api.game_reveals,
  api.revealed_key_points
to game_web, judge_worker;

grant select, insert, update on table
  private.player_identities,
  private.game_secrets,
  private.key_points,
  private.key_point_claims,
  private.key_point_extraction_jobs,
  private.game_actions,
  private.final_answer_submissions,
  private.judge_attempts,
  private.admin_audit_events,
  private.request_idempotency,
  private.rate_limit_buckets,
  private.worker_heartbeats
to game_web, judge_worker;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'players',
    'games',
    'messages',
    'game_events',
    'game_player_stats',
    'game_reveals',
    'revealed_key_points'
  ] loop
    execute format('alter table api.%I enable row level security', table_name);
    execute format('alter table api.%I force row level security', table_name);
    execute format(
      'create policy %I on api.%I for select to anon, authenticated using (true)',
      table_name || '_public_read', table_name
    );
    execute format(
      'create policy %I on api.%I for all to game_web using (true) with check (true)',
      table_name || '_game_web_all', table_name
    );
    execute format(
      'create policy %I on api.%I for all to judge_worker using (true) with check (true)',
      table_name || '_judge_worker_all', table_name
    );
  end loop;

  foreach table_name in array array[
    'player_identities',
    'game_secrets',
    'key_points',
    'key_point_claims',
    'key_point_extraction_jobs',
    'game_actions',
    'final_answer_submissions',
    'judge_attempts',
    'admin_audit_events',
    'request_idempotency',
    'rate_limit_buckets',
    'worker_heartbeats'
  ] loop
    execute format('alter table private.%I enable row level security', table_name);
    execute format('alter table private.%I force row level security', table_name);
    execute format(
      'create policy %I on private.%I for all to game_web using (true) with check (true)',
      table_name || '_game_web_all', table_name
    );
    execute format(
      'create policy %I on private.%I for all to judge_worker using (true) with check (true)',
      table_name || '_judge_worker_all', table_name
    );
  end loop;
end
$$;

alter default privileges in schema api
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema private
  revoke all on tables from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'players',
      'games',
      'messages',
      'game_events',
      'game_player_stats',
      'game_reveals',
      'revealed_key_points'
    ] loop
      begin
        execute format('alter publication supabase_realtime add table api.%I', table_name);
      exception
        when duplicate_object then null;
      end;
    end loop;
  end if;
end
$$;
