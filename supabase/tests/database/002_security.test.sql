begin;

select plan(56);

select ok(has_schema_privilege('anon', 'api', 'USAGE'), 'anon can use the exposed api schema');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon cannot use the private schema');
select ok(has_table_privilege('anon', 'api.games', 'SELECT'), 'anon can read public games');
select ok(has_table_privilege('anon', 'api.messages', 'SELECT'), 'anon can read public messages');
select ok(not has_table_privilege('anon', 'api.games', 'INSERT'), 'anon cannot insert games');
select ok(not has_table_privilege('anon', 'api.games', 'UPDATE'), 'anon cannot update games');
select ok(not has_table_privilege('anon', 'api.games', 'DELETE'), 'anon cannot delete games');
select ok(not has_table_privilege('anon', 'private.game_secrets', 'SELECT'), 'anon cannot read stored solutions');

select ok(
  (select relrowsecurity from pg_class where oid = 'api.games'::regclass),
  'RLS is enabled for api.games'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'api.games'::regclass),
  'RLS is forced for api.games'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'api.game_reveals'::regclass),
  'RLS is enabled for api.game_reveals'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.game_secrets'::regclass),
  'RLS is enabled for private.game_secrets'
);

select ok(has_schema_privilege('game_web', 'private', 'USAGE'), 'web role can use private schema');
select ok(has_table_privilege('game_web', 'private.game_secrets', 'INSERT'), 'web role can store preparations');
select ok(has_table_privilege('judge_worker', 'private.game_actions', 'UPDATE'), 'worker role can lease actions');
select ok(has_table_privilege('judge_worker', 'api.messages', 'UPDATE'), 'worker role can publish verdicts');

select ok(has_table_privilege('game_web', 'api.players', 'INSERT'), 'web role can create players');
select ok(has_table_privilege('game_web', 'api.games', 'UPDATE'), 'web role can update game counters and preparation');
select ok(has_table_privilege('game_web', 'api.messages', 'INSERT'), 'web role can accept public questions');
select ok(not has_table_privilege('game_web', 'api.messages', 'UPDATE'), 'web role cannot publish message verdicts');
select ok(has_column_privilege('game_web', 'api.messages', 'challenge_status', 'UPDATE'), 'web role can update only challenge status');
select ok(has_column_privilege('game_web', 'api.messages', 'updated_at', 'UPDATE'), 'web role can update challenge timestamps');
select ok(has_table_privilege('game_web', 'private.game_actions', 'SELECT'), 'web role can inspect action idempotency');
select ok(has_table_privilege('game_web', 'private.game_actions', 'INSERT'), 'web role can enqueue normal actions');
select ok(has_table_privilege('game_web', 'private.game_actions', 'UPDATE'), 'web role can cancel or retry actions through the admin boundary');
select ok(has_table_privilege('game_web', 'private.final_answer_submissions', 'INSERT'), 'web role can store private final-answer receipts');
select ok(has_table_privilege('game_web', 'private.key_points', 'SELECT'), 'web role can copy fixed key points during force end');
select ok(has_table_privilege('game_web', 'api.game_events', 'INSERT'), 'web role can publish force-end events');
select ok(has_table_privilege('game_web', 'api.game_reveals', 'INSERT'), 'web role can publish force-end reveals');
select ok(has_table_privilege('game_web', 'api.revealed_key_points', 'INSERT'), 'web role can publish force-end key points');
select ok(has_table_privilege('game_web', 'private.request_idempotency', 'UPDATE'), 'web role can bind request idempotency results');
select ok(not has_table_privilege('game_web', 'private.judge_attempts', 'SELECT'), 'web role cannot read judge attempts');
select ok(has_table_privilege('judge_worker', 'private.judge_attempts', 'INSERT'), 'worker can insert judge attempt metadata');
select ok(not has_table_privilege('judge_worker', 'private.judge_attempts', 'SELECT'), 'worker cannot read historical judge attempts');
select ok(not has_table_privilege('game_web', 'private.key_point_claims', 'INSERT'), 'web role cannot award key-point claims');
select ok(has_table_privilege('judge_worker', 'private.game_secrets', 'SELECT'), 'worker role can read the current secret input');
select ok(has_table_privilege('judge_worker', 'private.key_points', 'INSERT'), 'worker role can publish extracted key points');
select ok(has_table_privilege('judge_worker', 'private.key_point_claims', 'INSERT'), 'worker role can record first-hit claims');
select ok(has_table_privilege('judge_worker', 'private.final_answer_submissions', 'SELECT'), 'worker role can read private final-answer bodies');
select ok(has_table_privilege('judge_worker', 'private.final_answer_submissions', 'UPDATE'), 'worker role can complete private final-answer receipts');
select ok(has_table_privilege('judge_worker', 'api.game_events', 'INSERT'), 'worker role can publish final-answer events');
select ok(has_table_privilege('judge_worker', 'api.game_reveals', 'INSERT'), 'worker role can publish success reveals');
select ok(has_table_privilege('judge_worker', 'api.revealed_key_points', 'INSERT'), 'worker role can publish success key points');
select ok(has_table_privilege('judge_worker', 'private.worker_heartbeats', 'INSERT'), 'worker role can create its heartbeat');
select ok(has_table_privilege('judge_worker', 'private.worker_heartbeats', 'SELECT'), 'worker role can inspect heartbeats for upsert');
select ok(has_table_privilege('judge_worker', 'private.worker_heartbeats', 'UPDATE'), 'worker role can refresh its heartbeat');
select ok(not has_table_privilege('judge_worker', 'private.player_identities', 'SELECT'), 'worker role cannot read player identities');
select ok(not has_table_privilege('judge_worker', 'private.admin_audit_events', 'SELECT'), 'worker role cannot read admin audits');
select ok(not has_table_privilege('judge_worker', 'private.request_idempotency', 'SELECT'), 'worker role cannot read request idempotency');
select ok(not has_table_privilege('judge_worker', 'private.rate_limit_buckets', 'INSERT'), 'worker role cannot write rate limits');
select ok(not has_table_privilege('game_web', 'private.worker_heartbeats', 'INSERT'), 'web role cannot write worker heartbeats');
select ok(has_table_privilege('judge_worker', 'api.players', 'UPDATE'), 'worker role can award lifetime points');
select ok(has_table_privilege('judge_worker', 'api.game_player_stats', 'UPDATE'), 'worker role can update question statistics');
select ok(not has_table_privilege('judge_worker', 'api.games', 'INSERT'), 'worker role cannot create games');


select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'api'
      and tablename = 'games'
  ),
  'public games are in Realtime'
);
select ok(
  not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'private'
  ),
  'private tables are not in Realtime'
);

select * from finish();
rollback;
