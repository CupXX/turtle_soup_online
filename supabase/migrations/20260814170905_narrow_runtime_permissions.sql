-- Keep the two application roles usable only for the first playable loop.
-- The previous migration intentionally granted both roles all DML on every
-- table; revoke that baseline before adding responsibility-specific grants.
revoke all privileges on all tables in schema api from game_web, judge_worker;
revoke all privileges on all tables in schema private from game_web, judge_worker;
revoke all privileges on all sequences in schema api from game_web, judge_worker;
revoke all privileges on all sequences in schema private from game_web, judge_worker;

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
    execute format('drop policy if exists %I on api.%I', table_name || '_game_web_all', table_name);
    execute format('drop policy if exists %I on api.%I', table_name || '_judge_worker_all', table_name);
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
    execute format('drop policy if exists %I on private.%I', table_name || '_game_web_all', table_name);
    execute format('drop policy if exists %I on private.%I', table_name || '_judge_worker_all', table_name);
  end loop;
end
$$;

-- game_web: browser-facing server routes, admin preparation, receipts,
-- idempotency, rate limits, and public snapshots.
grant select, insert on table api.players to game_web;
grant select, insert, update on table api.games to game_web;
grant select, insert on table api.messages to game_web;
grant select on table api.game_events, api.game_reveals, api.revealed_key_points to game_web;
grant select, insert, update on table api.game_player_stats to game_web;
grant select, insert on table private.player_identities to game_web;
grant select, insert, update on table private.game_secrets to game_web;
grant select, insert, update on table private.key_point_extraction_jobs to game_web;
grant select, insert on table private.game_actions to game_web;
grant select, insert, update on table private.request_idempotency to game_web;
grant select, insert, update on table private.rate_limit_buckets to game_web;
grant select on table private.worker_heartbeats to game_web;

create policy players_game_web_select on api.players for select to game_web using (true);
create policy players_game_web_insert on api.players for insert to game_web with check (true);
create policy games_game_web_select on api.games for select to game_web using (true);
create policy games_game_web_insert on api.games for insert to game_web with check (true);
create policy games_game_web_update on api.games for update to game_web using (true) with check (true);
create policy messages_game_web_select on api.messages for select to game_web using (true);
create policy messages_game_web_insert on api.messages for insert to game_web with check (true);
create policy game_events_game_web_select on api.game_events for select to game_web using (true);
create policy game_player_stats_game_web_select on api.game_player_stats for select to game_web using (true);
create policy game_player_stats_game_web_insert on api.game_player_stats for insert to game_web with check (true);
create policy game_player_stats_game_web_update on api.game_player_stats for update to game_web using (true) with check (true);
create policy game_reveals_game_web_select on api.game_reveals for select to game_web using (true);
create policy revealed_key_points_game_web_select on api.revealed_key_points for select to game_web using (true);
create policy player_identities_game_web_select on private.player_identities for select to game_web using (true);
create policy player_identities_game_web_insert on private.player_identities for insert to game_web with check (true);
create policy game_secrets_game_web_select on private.game_secrets for select to game_web using (true);
create policy game_secrets_game_web_insert on private.game_secrets for insert to game_web with check (true);
create policy game_secrets_game_web_update on private.game_secrets for update to game_web using (true) with check (true);
create policy extraction_jobs_game_web_select on private.key_point_extraction_jobs for select to game_web using (true);
create policy extraction_jobs_game_web_insert on private.key_point_extraction_jobs for insert to game_web with check (true);
create policy extraction_jobs_game_web_update on private.key_point_extraction_jobs for update to game_web using (true) with check (true);
create policy actions_game_web_select on private.game_actions for select to game_web using (true);
create policy actions_game_web_insert on private.game_actions for insert to game_web with check (true);
create policy request_idempotency_game_web_select on private.request_idempotency for select to game_web using (true);
create policy request_idempotency_game_web_insert on private.request_idempotency for insert to game_web with check (true);
create policy request_idempotency_game_web_update on private.request_idempotency for update to game_web using (true) with check (true);
create policy rate_limits_game_web_select on private.rate_limit_buckets for select to game_web using (true);
create policy rate_limits_game_web_insert on private.rate_limit_buckets for insert to game_web with check (true);
create policy rate_limits_game_web_update on private.rate_limit_buckets for update to game_web using (true) with check (true);
create policy heartbeats_game_web_select on private.worker_heartbeats for select to game_web using (true);

-- judge_worker: the serial extraction/question queue and its public results.
grant select, update on table api.players, api.games, api.messages, api.game_player_stats to judge_worker;
grant select on table private.game_secrets, private.key_points, private.key_point_extraction_jobs, private.game_actions, private.key_point_claims to judge_worker;
grant insert on table private.key_points, private.key_point_claims to judge_worker;
grant update on table private.key_point_extraction_jobs, private.game_actions to judge_worker;
grant select, insert, update on table private.worker_heartbeats to judge_worker;

create policy players_judge_worker_select on api.players for select to judge_worker using (true);
create policy players_judge_worker_update on api.players for update to judge_worker using (true) with check (true);
create policy games_judge_worker_select on api.games for select to judge_worker using (true);
create policy games_judge_worker_update on api.games for update to judge_worker using (true) with check (true);
create policy messages_judge_worker_select on api.messages for select to judge_worker using (true);
create policy messages_judge_worker_update on api.messages for update to judge_worker using (true) with check (true);
create policy stats_judge_worker_select on api.game_player_stats for select to judge_worker using (true);
create policy stats_judge_worker_update on api.game_player_stats for update to judge_worker using (true) with check (true);
create policy secrets_judge_worker_select on private.game_secrets for select to judge_worker using (true);
create policy key_points_judge_worker_select on private.key_points for select to judge_worker using (true);
create policy key_points_judge_worker_insert on private.key_points for insert to judge_worker with check (true);
create policy claims_judge_worker_select on private.key_point_claims for select to judge_worker using (true);
create policy claims_judge_worker_insert on private.key_point_claims for insert to judge_worker with check (true);
create policy extraction_jobs_judge_worker_select on private.key_point_extraction_jobs for select to judge_worker using (true);
create policy extraction_jobs_judge_worker_update on private.key_point_extraction_jobs for update to judge_worker using (true) with check (true);
create policy actions_judge_worker_select on private.game_actions for select to judge_worker using (true);
create policy actions_judge_worker_update on private.game_actions for update to judge_worker using (true) with check (true);
create policy heartbeats_judge_worker_insert on private.worker_heartbeats for insert to judge_worker with check (true);
create policy heartbeats_judge_worker_select on private.worker_heartbeats for select to judge_worker using (true);
create policy heartbeats_judge_worker_update on private.worker_heartbeats for update to judge_worker using (true) with check (true);

alter default privileges in schema api revoke all on tables from game_web, judge_worker;
alter default privileges in schema private revoke all on tables from game_web, judge_worker;
