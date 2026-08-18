create table api.game_progress_summaries (
  game_id uuid primary key references api.games(id) on delete cascade,
  through_question_count integer not null default 0,
  through_sequence_no bigint not null default 0,
  source_fingerprint text,
  confirmed_facts text[] not null default '{}',
  ruled_out_facts text[] not null default '{}',
  irrelevant_topics text[] not null default '{}',
  generation_status text not null default 'PENDING',
  target_question_count integer,
  target_sequence_no bigint,
  target_source_fingerprint text,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint game_progress_summaries_through_count_check check (
    through_question_count >= 0 and through_question_count % 10 = 0
  ),
  constraint game_progress_summaries_through_sequence_check check (through_sequence_no >= 0),
  constraint game_progress_summaries_source_fingerprint_check check (
    source_fingerprint is null or char_length(source_fingerprint) = 64
  ),
  constraint game_progress_summaries_generation_status_check check (
    generation_status in ('PENDING', 'READY', 'ERROR')
  ),
  constraint game_progress_summaries_target_count_check check (
    target_question_count is null or (target_question_count >= 10 and target_question_count % 10 = 0)
  ),
  constraint game_progress_summaries_target_sequence_check check (target_sequence_no is null or target_sequence_no > 0),
  constraint game_progress_summaries_target_fingerprint_check check (
    target_source_fingerprint is null or char_length(target_source_fingerprint) = 64
  )
);

create table private.progress_summary_jobs (
  id uuid primary key,
  game_id uuid not null references api.games(id) on delete cascade,
  through_question_count integer not null,
  through_sequence_no bigint not null,
  source_fingerprint text not null,
  status text not null,
  attempt_count smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_summary_jobs_boundary_check check (through_question_count >= 10 and through_question_count % 10 = 0),
  constraint progress_summary_jobs_sequence_check check (through_sequence_no > 0),
  constraint progress_summary_jobs_source_fingerprint_check check (char_length(source_fingerprint) = 64),
  constraint progress_summary_jobs_status_check check (
    status in ('PENDING', 'PROCESSING', 'RETRY', 'BLOCKED', 'COMPLETED', 'STALE', 'CANCELLED')
  ),
  constraint progress_summary_jobs_attempt_count_check check (attempt_count between 0 and 4),
  constraint progress_summary_jobs_game_boundary_source_key unique (game_id, through_question_count, source_fingerprint)
);

create index progress_summary_jobs_game_id_idx on private.progress_summary_jobs (game_id);
create index progress_summary_jobs_claim_idx
  on private.progress_summary_jobs (status, next_attempt_at, created_at);

create trigger game_progress_summaries_set_updated_at
before update on api.game_progress_summaries
for each row execute function private.set_updated_at();

create trigger progress_summary_jobs_set_updated_at
before update on private.progress_summary_jobs
for each row execute function private.set_updated_at();

alter table private.judge_attempts
  add column progress_summary_job_id uuid references private.progress_summary_jobs(id);

create index judge_attempts_progress_summary_job_id_idx
  on private.judge_attempts (progress_summary_job_id, attempt_no);

alter table private.judge_attempts
  drop constraint if exists judge_attempts_one_parent;

alter table private.judge_attempts
  add constraint judge_attempts_one_parent
  check (num_nonnulls(action_id, extraction_job_id, progress_summary_job_id) = 1);

alter table private.judge_attempts
  drop constraint if exists judge_attempts_skill_type_check;

alter table private.judge_attempts
  add constraint judge_attempts_skill_type_check
  check (skill_type in ('key-point-extraction', 'question-judge', 'final-answer-judge', 'progress-summary'));

grant select on table api.game_progress_summaries to anon, authenticated, game_web, judge_worker;
grant insert, update on table api.game_progress_summaries to judge_worker;

grant select, insert, update on table private.progress_summary_jobs to judge_worker;

alter table api.game_progress_summaries enable row level security;
alter table api.game_progress_summaries force row level security;
create policy game_progress_summaries_anon_select
  on api.game_progress_summaries for select to anon using (true);
create policy game_progress_summaries_authenticated_select
  on api.game_progress_summaries for select to authenticated using (true);
create policy game_progress_summaries_game_web_select
  on api.game_progress_summaries for select to game_web using (true);
create policy game_progress_summaries_judge_worker_select
  on api.game_progress_summaries for select to judge_worker using (true);
create policy game_progress_summaries_judge_worker_insert
  on api.game_progress_summaries for insert to judge_worker with check (true);
create policy game_progress_summaries_judge_worker_update
  on api.game_progress_summaries for update to judge_worker using (true) with check (true);

alter table private.progress_summary_jobs enable row level security;
alter table private.progress_summary_jobs force row level security;
create policy progress_summary_jobs_judge_worker_select
  on private.progress_summary_jobs for select to judge_worker using (true);
create policy progress_summary_jobs_judge_worker_insert
  on private.progress_summary_jobs for insert to judge_worker with check (true);
create policy progress_summary_jobs_judge_worker_update
  on private.progress_summary_jobs for update to judge_worker using (true) with check (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table api.game_progress_summaries;
    exception
      when duplicate_object then null;
    end;
  end if;
end
$$;
