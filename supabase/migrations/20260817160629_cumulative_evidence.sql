-- Cumulative key-point discovery stores hidden atomic facts separately from
-- player-facing milestones. Existing games without rows remain legacy mode.

create table private.key_point_evidence (
  id uuid primary key,
  key_point_id uuid not null references private.key_points(id),
  ordinal smallint not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint key_point_evidence_ordinal_range check (ordinal between 1 and 4),
  constraint key_point_evidence_content_length check (char_length(content) between 1 and 2000),
  constraint key_point_evidence_key_point_ordinal_unique unique (key_point_id, ordinal)
);

alter table private.question_judgments
  add column original_established_evidence_ids uuid[] not null default '{}',
  add column current_established_evidence_ids uuid[] not null default '{}';

alter table private.message_challenges
  add column resolved_established_evidence_ids uuid[];

alter table private.challenge_judgments
  add column established_evidence_ids uuid[] not null default '{}';

create index key_point_evidence_key_point_id_idx
  on private.key_point_evidence (key_point_id, ordinal);
create index question_judgments_current_evidence_idx
  on private.question_judgments using gin (current_established_evidence_ids);
create index challenge_judgments_evidence_idx
  on private.challenge_judgments using gin (established_evidence_ids);

create or replace function private.prevent_active_key_point_evidence_mutation()
returns trigger
language plpgsql
as $$
declare
  game_status api.game_status;
begin
  select games.status
    into game_status
  from private.key_points points
  join api.games games on games.id = points.game_id
  where points.id = case when tg_op = 'DELETE' then old.key_point_id else new.key_point_id end;

  if game_status in ('ACTIVE', 'ENDED') then
    raise exception 'key-point Evidence is immutable after activation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger key_point_evidence_immutable_after_activation
before update or delete on private.key_point_evidence
for each row execute function private.prevent_active_key_point_evidence_mutation();

grant select, insert on table private.key_point_evidence to judge_worker;
create policy key_point_evidence_judge_worker_select
  on private.key_point_evidence for select to judge_worker using (true);
create policy key_point_evidence_judge_worker_insert
  on private.key_point_evidence for insert to judge_worker with check (true);
alter table private.key_point_evidence enable row level security;
alter table private.key_point_evidence force row level security;
