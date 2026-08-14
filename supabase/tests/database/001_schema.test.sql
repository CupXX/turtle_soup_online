begin;

select plan(36);

select has_schema('api', 'public API schema');
select has_schema('private', 'private persistence schema');

select has_enum('api', 'game_status');
select enum_has_labels('api', 'game_status', array['WAITING', 'ACTIVE', 'ENDED']);
select has_enum('api', 'game_end_reason');
select enum_has_labels('api', 'game_end_reason', array['FINAL_ANSWER_SUCCESS', 'FORCE_ENDED']);
select has_enum('api', 'public_game_event_type');
select has_enum('api', 'message_status');
select has_enum('api', 'judge_verdict');
select has_enum('private', 'action_type');
select has_enum('private', 'action_status');
select has_enum('private', 'job_status');

select has_table('api', 'players');
select has_table('api', 'games');
select has_table('api', 'messages');
select has_table('api', 'game_events');
select has_table('api', 'game_player_stats');
select has_table('api', 'game_reveals');
select has_table('api', 'revealed_key_points');
select has_table('private', 'player_identities');
select has_table('private', 'game_secrets');
select has_table('private', 'key_points');
select has_table('private', 'key_point_claims');
select has_table('private', 'key_point_extraction_jobs');
select has_table('private', 'game_actions');
select has_table('private', 'final_answer_submissions');
select has_table('private', 'judge_attempts');
select has_table('private', 'admin_audit_events');
select has_table('private', 'request_idempotency');
select has_table('private', 'rate_limit_buckets');
select has_table('private', 'worker_heartbeats');

select has_pk('private', 'key_point_claims', 'key-point claims are first-owner unique');
select has_index('api', 'messages', array['game_id', 'sequence_no']);
select has_index('api', 'game_events', array['game_id', 'sequence_no']);
select has_index('private', 'key_points', array['game_id', 'ordinal']);
select has_index('private', 'game_actions', 'game_actions_queue_head_idx');
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'api'
      and tablename = 'games'
      and indexname = 'games_single_open_idx'
      and indexdef like '%WHERE%'
  ),
  'only one WAITING or ACTIVE game is allowed'
);

select * from finish();
rollback;
