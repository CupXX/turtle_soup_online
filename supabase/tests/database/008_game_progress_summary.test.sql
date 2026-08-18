begin;

select * from no_plan();

select has_table('api', 'game_progress_summaries'::name);
select has_column('api', 'game_progress_summaries', 'game_id'::name);
select has_column('api', 'game_progress_summaries', 'through_question_count'::name);
select has_column('api', 'game_progress_summaries', 'through_sequence_no'::name);
select has_column('api', 'game_progress_summaries', 'source_fingerprint'::name);
select has_column('api', 'game_progress_summaries', 'confirmed_facts'::name);
select has_column('api', 'game_progress_summaries', 'ruled_out_facts'::name);
select has_column('api', 'game_progress_summaries', 'irrelevant_topics'::name);
select has_column('api', 'game_progress_summaries', 'generation_status'::name);
select has_column('api', 'game_progress_summaries', 'target_question_count'::name);
select has_column('api', 'game_progress_summaries', 'target_sequence_no'::name);
select has_column('api', 'game_progress_summaries', 'target_source_fingerprint'::name);
select has_column('api', 'game_progress_summaries', 'generated_at'::name);
select has_column('api', 'game_progress_summaries', 'updated_at'::name);

select has_table('private', 'progress_summary_jobs'::name);
select has_column('private', 'progress_summary_jobs', 'id'::name);
select has_column('private', 'progress_summary_jobs', 'game_id'::name);
select has_column('private', 'progress_summary_jobs', 'through_question_count'::name);
select has_column('private', 'progress_summary_jobs', 'through_sequence_no'::name);
select has_column('private', 'progress_summary_jobs', 'source_fingerprint'::name);
select has_column('private', 'progress_summary_jobs', 'status'::name);
select has_column('private', 'progress_summary_jobs', 'attempt_count'::name);
select has_column('private', 'progress_summary_jobs', 'next_attempt_at'::name);
select has_column('private', 'progress_summary_jobs', 'lease_owner'::name);
select has_column('private', 'progress_summary_jobs', 'lease_expires_at'::name);
select has_column('private', 'progress_summary_jobs', 'error_code'::name);
select has_column('private', 'progress_summary_jobs', 'created_at'::name);
select has_column('private', 'progress_summary_jobs', 'updated_at'::name);
select has_column('private', 'judge_attempts', 'progress_summary_job_id'::name);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.progress_summary_jobs'::regclass
      and contype = 'u'
      and conname = 'progress_summary_jobs_game_boundary_source_key'
  ),
  'summary jobs are unique across every status for one source boundary'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'api.game_progress_summaries'::regclass
      and conname = 'game_progress_summaries_game_id_fkey'
      and confrelid = 'api.games'::regclass
  ),
  'public summary rows cascade with their game'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.progress_summary_jobs'::regclass
      and conname = 'progress_summary_jobs_game_id_fkey'
      and confrelid = 'api.games'::regclass
  ),
  'summary jobs cascade with their game'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.judge_attempts'::regclass
      and conname = 'judge_attempts_progress_summary_job_id_fkey'
      and confrelid = 'private.progress_summary_jobs'::regclass
  ),
  'summary audit rows reference their private job'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.judge_attempts'::regclass
      and conname = 'judge_attempts_one_parent'
      and pg_get_constraintdef(oid) like '%progress_summary_job_id%'
  ),
  'judge attempts require exactly one of action, extraction, or summary parent'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'api.game_progress_summaries'::regclass
      and conname = 'game_progress_summaries_generation_status_check'
  ),
  'public summary status is constrained to the public lifecycle'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.progress_summary_jobs'::regclass
      and conname = 'progress_summary_jobs_status_check'
  ),
  'private summary jobs use the finite queue lifecycle'
);

select ok(
  coalesce((select relforcerowsecurity from pg_class where oid = to_regclass('api.game_progress_summaries')), false),
  'public summary state forces RLS'
);
select ok(
  coalesce((select relforcerowsecurity from pg_class where oid = to_regclass('private.progress_summary_jobs')), false),
  'private summary jobs force RLS'
);

select ok(
  case when to_regclass('api.game_progress_summaries') is null then false
       else has_table_privilege('anon', 'api.game_progress_summaries', 'SELECT') end,
  'anon can read public summary state'
);
select ok(
  case when to_regclass('api.game_progress_summaries') is null then false
       else not has_table_privilege('anon', 'api.game_progress_summaries', 'INSERT') end,
  'anon cannot insert public summary state'
);
select ok(
  case when to_regclass('api.game_progress_summaries') is null then false
       else not has_table_privilege('anon', 'api.game_progress_summaries', 'UPDATE') end,
  'anon cannot update public summary state'
);
select ok(
  case when to_regclass('api.game_progress_summaries') is null then false
       else has_table_privilege('authenticated', 'api.game_progress_summaries', 'SELECT') end,
  'authenticated can read public summary state'
);
select ok(
  case when to_regclass('api.game_progress_summaries') is null then false
       else has_table_privilege('game_web', 'api.game_progress_summaries', 'SELECT') end,
  'web role can read public summary state'
);
select ok(
  case when to_regclass('api.game_progress_summaries') is null then false
       else not has_table_privilege('game_web', 'api.game_progress_summaries', 'INSERT') end,
  'web role cannot insert public summary state'
);
select ok(
  case when to_regclass('api.game_progress_summaries') is null then false
       else not has_table_privilege('game_web', 'api.game_progress_summaries', 'UPDATE') end,
  'web role cannot update public summary state'
);
select ok(
  case when to_regclass('api.game_progress_summaries') is null then false
       else has_table_privilege('judge_worker', 'api.game_progress_summaries', 'SELECT') end,
  'worker can read public summary state'
);
select ok(
  case when to_regclass('api.game_progress_summaries') is null then false
       else has_table_privilege('judge_worker', 'api.game_progress_summaries', 'INSERT') end,
  'worker can create public summary state'
);
select ok(
  case when to_regclass('api.game_progress_summaries') is null then false
       else has_table_privilege('judge_worker', 'api.game_progress_summaries', 'UPDATE') end,
  'worker can update public summary state'
);
select ok(
  case when to_regclass('private.progress_summary_jobs') is null then false
       else not has_table_privilege('anon', 'private.progress_summary_jobs', 'SELECT') end,
  'anon cannot read private summary jobs'
);
select ok(
  case when to_regclass('private.progress_summary_jobs') is null then false
       else not has_table_privilege('game_web', 'private.progress_summary_jobs', 'SELECT') end,
  'web role cannot read private summary jobs'
);
select ok(
  case when to_regclass('private.progress_summary_jobs') is null then false
       else has_table_privilege('judge_worker', 'private.progress_summary_jobs', 'SELECT') end,
  'worker can claim private summary jobs'
);
select ok(
  case when to_regclass('private.progress_summary_jobs') is null then false
       else has_table_privilege('judge_worker', 'private.progress_summary_jobs', 'INSERT') end,
  'worker can enqueue private summary jobs'
);
select ok(
  case when to_regclass('private.progress_summary_jobs') is null then false
       else has_table_privilege('judge_worker', 'private.progress_summary_jobs', 'UPDATE') end,
  'worker can lease and complete private summary jobs'
);

select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'api'
      and tablename = 'game_progress_summaries'
  ),
  'public summary state is in Realtime'
);
select ok(
  not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'private'
      and tablename = 'progress_summary_jobs'
  ),
  'private summary jobs are not in Realtime'
);

select * from finish();
rollback;
