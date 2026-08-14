begin;

select plan(37);

select has_schema('api', 'public API schema');
select has_schema('private', 'private persistence schema');

select has_enum('api', 'game_status'::name);
select enum_has_labels('api', 'game_status', array['WAITING', 'ACTIVE', 'ENDED']);
select has_enum('api', 'game_end_reason'::name);
select enum_has_labels('api', 'game_end_reason', array['FINAL_ANSWER_SUCCESS', 'FORCE_ENDED']);
select has_enum('api', 'public_game_event_type'::name);
select has_enum('api', 'message_status'::name);
select has_enum('api', 'judge_verdict'::name);
select has_enum('private', 'action_type'::name);
select has_enum('private', 'action_status'::name);
select has_enum('private', 'job_status'::name);

select has_table('api', 'players'::name);
select has_table('api', 'games'::name);
select has_table('api', 'messages'::name);
select has_table('api', 'game_events'::name);
select has_table('api', 'game_player_stats'::name);
select has_table('api', 'game_reveals'::name);
select has_table('api', 'revealed_key_points'::name);
select has_table('private', 'player_identities'::name);
select has_table('private', 'game_secrets'::name);
select has_table('private', 'key_points'::name);
select has_table('private', 'key_point_claims'::name);
select has_table('private', 'key_point_extraction_jobs'::name);
select has_table('private', 'game_actions'::name);
select has_table('private', 'final_answer_submissions'::name);
select has_table('private', 'judge_attempts'::name);
select has_table('private', 'admin_audit_events'::name);
select has_table('private', 'request_idempotency'::name);
select has_table('private', 'rate_limit_buckets'::name);
select has_table('private', 'worker_heartbeats'::name);

select has_pk('private', 'key_point_claims', 'key-point claims are first-owner unique');
select has_index('api', 'messages', 'messages_game_sequence_idx', array['game_id', 'sequence_no']);
select has_index('api', 'game_events', 'game_events_game_sequence_idx', array['game_id', 'sequence_no']);
select has_index('private', 'key_points', 'key_points_game_ordinal_idx', array['game_id', 'ordinal']);
select has_index('private', 'game_actions', 'game_actions_queue_head_idx'::name);
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
