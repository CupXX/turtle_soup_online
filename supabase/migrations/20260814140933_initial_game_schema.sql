create schema api;
create schema private;

create type api.game_status as enum ('WAITING', 'ACTIVE', 'ENDED');
create type api.game_end_reason as enum ('FINAL_ANSWER_SUCCESS', 'FORCE_ENDED');
create type api.public_game_event_type as enum (
  'FINAL_ANSWER_FAILED',
  'FINAL_ANSWER_SUCCEEDED',
  'FORCE_ENDED'
);
create type api.message_status as enum ('PENDING', 'JUDGED', 'ERROR', 'CANCELLED');
create type api.judge_verdict as enum ('YES', 'NO', 'BOTH', 'IRRELEVANT');
create type private.action_type as enum ('NORMAL_MESSAGE', 'FINAL_ANSWER');
create type private.action_status as enum (
  'PENDING',
  'PROCESSING',
  'RETRY',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED'
);
create type private.job_status as enum (
  'PENDING',
  'PROCESSING',
  'RETRY',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED'
);

create table api.players (
  id uuid primary key,
  display_nickname text not null,
  lifetime_score integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_display_nickname_length check (char_length(display_nickname) between 1 and 24),
  constraint players_lifetime_score_nonnegative check (lifetime_score >= 0)
);

create table api.games (
  id uuid primary key,
  status api.game_status not null,
  puzzle_surface text,
  key_point_total smallint not null default 0,
  discovered_key_point_count smallint not null default 0,
  total_question_count integer not null default 0,
  end_reason api.game_end_reason,
  winner_player_id uuid references api.players(id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint games_key_point_total_range check (key_point_total between 0 and 5),
  constraint games_discovered_key_point_count_range check (
    discovered_key_point_count between 0 and key_point_total
  ),
  constraint games_total_question_count_nonnegative check (total_question_count >= 0),
  constraint games_puzzle_surface_length check (
    puzzle_surface is null or char_length(puzzle_surface) between 1 and 2000
  ),
  constraint games_status_fields_consistent check (
    (status = 'WAITING' and puzzle_surface is null and activated_at is null and ended_at is null and end_reason is null)
    or (status = 'ACTIVE' and puzzle_surface is not null and activated_at is not null and ended_at is null and end_reason is null)
    or (status = 'ENDED' and puzzle_surface is not null and activated_at is not null and ended_at is not null and end_reason is not null)
  )
);

create table api.messages (
  id uuid primary key,
  game_id uuid not null references api.games(id),
  player_id uuid not null references api.players(id),
  sequence_no bigint not null,
  content text not null,
  status api.message_status not null,
  verdict api.judge_verdict,
  awarded_points smallint not null default 0,
  created_at timestamptz not null default now(),
  judged_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint messages_sequence_positive check (sequence_no > 0),
  constraint messages_content_length check (char_length(content) between 1 and 500),
  constraint messages_awarded_points_range check (awarded_points between 0 and 5),
  constraint messages_sequence_unique unique (game_id, sequence_no)
);

create table api.game_events (
  id uuid primary key,
  game_id uuid not null references api.games(id),
  sequence_no bigint not null,
  event_type api.public_game_event_type not null,
  player_id uuid references api.players(id),
  awarded_points smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint game_events_sequence_positive check (sequence_no > 0),
  constraint game_events_awarded_points_range check (awarded_points between 0 and 5),
  constraint game_events_sequence_unique unique (game_id, sequence_no)
);

create table api.game_player_stats (
  game_id uuid not null references api.games(id),
  player_id uuid not null references api.players(id),
  question_count integer not null default 0,
  yes_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint game_player_stats_pk primary key (game_id, player_id),
  constraint game_player_stats_question_count_nonnegative check (question_count >= 0),
  constraint game_player_stats_yes_count_nonnegative check (yes_count >= 0),
  constraint game_player_stats_yes_not_over_questions check (yes_count <= question_count)
);

create table api.game_reveals (
  game_id uuid primary key references api.games(id),
  full_solution text not null,
  revealed_at timestamptz not null default now(),
  constraint game_reveals_solution_length check (char_length(full_solution) between 1 and 8000)
);

create table api.revealed_key_points (
  game_id uuid not null references api.games(id),
  ordinal smallint not null,
  content text not null,
  constraint revealed_key_points_pk primary key (game_id, ordinal),
  constraint revealed_key_points_ordinal_range check (ordinal between 1 and 5),
  constraint revealed_key_points_content_length check (char_length(content) between 1 and 2000)
);

create table private.player_identities (
  player_id uuid primary key references api.players(id),
  nickname_key text not null unique,
  constraint player_identities_nickname_key_nonempty check (char_length(nickname_key) between 1 and 24)
);

create table private.game_secrets (
  game_id uuid primary key references api.games(id),
  puzzle_surface text not null,
  full_solution text not null,
  input_version integer not null,
  updated_at timestamptz not null default now(),
  constraint game_secrets_surface_length check (char_length(puzzle_surface) between 1 and 2000),
  constraint game_secrets_solution_length check (char_length(full_solution) between 1 and 8000),
  constraint game_secrets_input_version_positive check (input_version >= 1)
);

create table private.key_points (
  id uuid primary key,
  game_id uuid not null references api.games(id),
  ordinal smallint not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint key_points_ordinal_range check (ordinal between 1 and 5),
  constraint key_points_content_length check (char_length(content) between 1 and 2000),
  constraint key_points_game_ordinal_unique unique (game_id, ordinal)
);

create table private.key_point_claims (
  key_point_id uuid primary key references private.key_points(id),
  game_id uuid not null references api.games(id),
  message_id uuid not null references api.messages(id),
  player_id uuid not null references api.players(id),
  claimed_at timestamptz not null default now()
);

create table private.key_point_extraction_jobs (
  id uuid primary key,
  game_id uuid not null references api.games(id),
  input_version integer not null,
  status private.job_status not null,
  attempt_count smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint extraction_jobs_input_version_positive check (input_version >= 1),
  constraint extraction_jobs_attempt_count_range check (attempt_count between 0 and 4),
  constraint extraction_jobs_unique_version unique (game_id, input_version)
);

create table private.game_actions (
  id uuid primary key,
  game_id uuid not null references api.games(id),
  player_id uuid not null references api.players(id),
  sequence_no bigint not null,
  action_type private.action_type not null,
  status private.action_status not null,
  attempt_count smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  idempotency_key uuid not null,
  payload_digest text not null,
  result_resource_id uuid,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_actions_sequence_positive check (sequence_no > 0),
  constraint game_actions_attempt_count_range check (attempt_count between 0 and 4),
  constraint game_actions_sequence_unique unique (game_id, sequence_no),
  constraint game_actions_idempotency_unique unique (game_id, player_id, action_type, idempotency_key)
);

create table private.final_answer_submissions (
  id uuid primary key,
  action_id uuid not null unique references private.game_actions(id),
  game_id uuid not null references api.games(id),
  player_id uuid not null references api.players(id),
  answer text not null,
  covered_key_point_ids uuid[] not null default '{}',
  status private.action_status not null,
  created_at timestamptz not null default now(),
  judged_at timestamptz,
  constraint final_answer_submissions_answer_length check (char_length(answer) between 1 and 4000)
);

create table private.judge_attempts (
  id uuid primary key,
  action_id uuid references private.game_actions(id),
  extraction_job_id uuid references private.key_point_extraction_jobs(id),
  provider text not null,
  model text not null,
  skill_version text not null,
  prompt_version text not null,
  schema_version text not null,
  attempt_no smallint not null,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  result_valid boolean not null default false,
  error_code text,
  created_at timestamptz not null default now(),
  constraint judge_attempts_one_parent check ((action_id is not null) <> (extraction_job_id is not null)),
  constraint judge_attempts_attempt_positive check (attempt_no between 1 and 4),
  constraint judge_attempts_latency_nonnegative check (latency_ms is null or latency_ms >= 0),
  constraint judge_attempts_input_tokens_nonnegative check (input_tokens is null or input_tokens >= 0),
  constraint judge_attempts_output_tokens_nonnegative check (output_tokens is null or output_tokens >= 0)
);

create table private.admin_audit_events (
  id uuid primary key,
  admin_nickname text not null,
  action_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table private.request_idempotency (
  actor_scope text not null,
  operation text not null,
  idempotency_key uuid not null,
  payload_digest text not null,
  result_resource_id uuid,
  response_status integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint request_idempotency_pk primary key (actor_scope, operation, idempotency_key),
  constraint request_idempotency_response_status check (response_status between 100 and 599)
);

create table private.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  count integer not null,
  expires_at timestamptz not null,
  constraint rate_limit_buckets_count_positive check (count > 0),
  constraint rate_limit_buckets_expiry_after_start check (expires_at > window_started_at)
);

create table private.worker_heartbeats (
  worker_id text primary key,
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  build_version text not null,
  constraint worker_heartbeats_last_seen_after_start check (last_seen_at >= started_at)
);

create unique index games_single_open_idx
  on api.games ((true))
  where status in ('WAITING', 'ACTIVE');

create index games_winner_player_id_idx on api.games (winner_player_id);
create index messages_game_sequence_idx on api.messages (game_id, sequence_no);
create index messages_player_id_idx on api.messages (player_id);
create index game_events_game_sequence_idx on api.game_events (game_id, sequence_no);
create index game_events_player_id_idx on api.game_events (player_id);
create index game_player_stats_player_id_idx on api.game_player_stats (player_id);
create index revealed_key_points_game_id_idx on api.revealed_key_points (game_id);
create index key_points_game_ordinal_idx on private.key_points (game_id, ordinal);
create index key_point_claims_game_id_idx on private.key_point_claims (game_id);
create index key_point_claims_message_id_idx on private.key_point_claims (message_id);
create index key_point_claims_player_id_idx on private.key_point_claims (player_id);
create index extraction_jobs_game_id_idx on private.key_point_extraction_jobs (game_id);
create index game_actions_player_id_idx on private.game_actions (player_id);
create index game_actions_queue_head_idx
  on private.game_actions (game_id, sequence_no)
  where status in ('PENDING', 'RETRY', 'BLOCKED');
create index final_answer_submissions_game_id_idx on private.final_answer_submissions (game_id);
create index final_answer_submissions_player_id_idx on private.final_answer_submissions (player_id);
create index judge_attempts_action_id_idx on private.judge_attempts (action_id, attempt_no);
create index judge_attempts_extraction_job_id_idx on private.judge_attempts (extraction_job_id, attempt_no);
create index admin_audit_events_target_id_idx on private.admin_audit_events (target_id);
create index worker_heartbeats_last_seen_idx on private.worker_heartbeats (last_seen_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.prevent_active_key_point_mutation()
returns trigger
language plpgsql
as $$
declare
  game_status api.game_status;
  game_id_value uuid;
begin
  game_id_value := case when tg_op = 'DELETE' then old.game_id else new.game_id end;
  select status into game_status from api.games where id = game_id_value;
  if game_status in ('ACTIVE', 'ENDED') then
    raise exception 'key points are immutable after activation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger players_set_updated_at
before update on api.players
for each row execute function private.set_updated_at();

create trigger games_set_updated_at
before update on api.games
for each row execute function private.set_updated_at();

create trigger messages_set_updated_at
before update on api.messages
for each row execute function private.set_updated_at();

create trigger game_player_stats_set_updated_at
before update on api.game_player_stats
for each row execute function private.set_updated_at();

create trigger game_secrets_set_updated_at
before update on private.game_secrets
for each row execute function private.set_updated_at();

create trigger extraction_jobs_set_updated_at
before update on private.key_point_extraction_jobs
for each row execute function private.set_updated_at();

create trigger game_actions_set_updated_at
before update on private.game_actions
for each row execute function private.set_updated_at();

create trigger request_idempotency_set_updated_at
before update on private.request_idempotency
for each row execute function private.set_updated_at();

create trigger key_points_immutable_after_activation
before update or delete on private.key_points
for each row execute function private.prevent_active_key_point_mutation();
