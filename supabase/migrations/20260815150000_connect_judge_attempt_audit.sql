alter table private.judge_attempts
  add column skill_type text,
  add column reasoning_effort text not null default 'off';

update private.judge_attempts
set skill_type = regexp_replace(skill_version, '-v[0-9]+$', '');

alter table private.judge_attempts
  alter column skill_type set not null,
  add constraint judge_attempts_skill_type_check
    check (skill_type in ('key-point-extraction', 'question-judge', 'final-answer-judge')),
  add constraint judge_attempts_reasoning_effort_check
    check (reasoning_effort in ('off', 'high', 'max'));

grant insert on table private.judge_attempts to judge_worker;

create policy judge_attempts_judge_worker_insert
  on private.judge_attempts
  for insert to judge_worker
  with check (true);
