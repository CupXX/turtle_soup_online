-- Challenge (质疑) keeps the original judgment immutable while allowing four
-- independent fresh judgments to resolve a public message atomically.

create type api.challenge_status as enum ('NONE', 'PENDING', 'RESOLVED', 'FAILED');

alter type private.action_type add value if not exists 'CHALLENGE';

alter table api.messages
  add column challenge_status api.challenge_status not null default 'NONE',
  add constraint messages_challenge_status_consistent check (
    challenge_status = 'NONE'
    or (status = 'JUDGED' and verdict is not null)
  );

create table private.question_judgments (
  message_id uuid primary key references api.messages(id),
  game_id uuid not null references api.games(id),
  player_id uuid not null references api.players(id),
  original_verdict api.judge_verdict not null,
  original_covered_key_point_ids uuid[] not null default '{}',
  current_verdict api.judge_verdict not null,
  current_covered_key_point_ids uuid[] not null default '{}',
  prompt_version text not null,
  schema_version text not null,
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint question_judgments_message_owner unique (message_id, game_id, player_id)
);

create table private.message_challenges (
  id uuid primary key,
  message_id uuid not null unique references api.messages(id),
  game_id uuid not null references api.games(id),
  player_id uuid not null references api.players(id),
  status api.challenge_status not null default 'PENDING',
  required_valid_judgments smallint not null default 5,
  valid_judgment_count smallint not null default 0,
  resolved_verdict api.judge_verdict,
  resolved_covered_key_point_ids uuid[],
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint message_challenges_required_count check (required_valid_judgments = 5),
  constraint message_challenges_valid_count_range check (valid_judgment_count between 0 and 5),
  constraint message_challenges_status_consistent check (
    (status in ('PENDING', 'FAILED') and resolved_at is null)
    or (status = 'RESOLVED' and resolved_at is not null and resolved_verdict is not null)
  )
);

create table private.challenge_judgments (
  id uuid primary key,
  challenge_id uuid not null references private.message_challenges(id),
  slot smallint not null,
  provider text not null,
  model text not null,
  reasoning_effort text not null,
  prompt_version text not null,
  schema_version text not null,
  verdict api.judge_verdict,
  covered_key_point_ids uuid[] not null default '{}',
  valid boolean not null default false,
  error_code text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  constraint challenge_judgments_slot_range check (slot between 1 and 4),
  constraint challenge_judgments_valid_result check (
    (valid = true and verdict is not null and error_code is null)
    or (valid = false)
  ),
  constraint challenge_judgments_latency_nonnegative check (latency_ms is null or latency_ms >= 0),
  constraint challenge_judgments_input_tokens_nonnegative check (input_tokens is null or input_tokens >= 0),
  constraint challenge_judgments_output_tokens_nonnegative check (output_tokens is null or output_tokens >= 0),
  constraint challenge_judgments_slot_unique unique (challenge_id, slot)
);

create index question_judgments_game_id_idx on private.question_judgments (game_id);
create index message_challenges_game_status_idx on private.message_challenges (game_id, status, created_at);
create index message_challenges_player_id_idx on private.message_challenges (player_id);
create index challenge_judgments_challenge_id_idx on private.challenge_judgments (challenge_id, slot);

create trigger question_judgments_set_updated_at
before update on private.question_judgments
for each row execute function private.set_updated_at();

create trigger message_challenges_set_updated_at
before update on private.message_challenges
for each row execute function private.set_updated_at();

-- The existing audit table was created before per-skill reasoning settings were
-- configurable. Keep historical rows and allow the configured values used by
-- Luna/DeepSeek/OpenAI comparisons.
alter table private.judge_attempts
  drop constraint if exists judge_attempts_reasoning_effort_check;
alter table private.judge_attempts
  add constraint judge_attempts_reasoning_effort_check
  check (reasoning_effort in ('off', 'none', 'low', 'medium', 'high', 'max'));

-- Browser-facing code may create a challenge and update only the public
-- challenge state on its target message. It never receives hidden judgment
-- rows, canonical solution data, or model output.
grant select, insert on table private.message_challenges to game_web;
grant update (challenge_status, updated_at) on table api.messages to game_web;
create policy message_challenges_game_web_select
  on private.message_challenges for select to game_web using (true);
create policy message_challenges_game_web_insert
  on private.message_challenges for insert to game_web with check (true);
create policy messages_game_web_challenge_update
  on api.messages for update to game_web using (true) with check (true);

-- The worker owns all private judgment rows and the atomic reconciliation.
grant select, insert, update on table private.question_judgments to judge_worker;
grant select, update on table private.message_challenges to judge_worker;
grant select, insert on table private.challenge_judgments to judge_worker;
create policy question_judgments_judge_worker_all
  on private.question_judgments for all to judge_worker using (true) with check (true);
create policy message_challenges_judge_worker_all
  on private.message_challenges for all to judge_worker using (true) with check (true);
create policy challenge_judgments_judge_worker_all
  on private.challenge_judgments for all to judge_worker using (true) with check (true);

-- Challenge actions are queued after the challenged message and use the same
-- serial action queue as normal questions/final answers.
