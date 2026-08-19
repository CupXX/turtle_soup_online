-- Final-answer completion uses ON CONFLICT to make public result writes
-- idempotent. The worker needs only SELECT for conflict detection; INSERT
-- remains the only write privilege on these public result tables.
grant select on table
  api.game_events,
  api.game_reveals,
  api.revealed_key_points
to judge_worker;

create policy game_events_judge_worker_select
  on api.game_events for select to judge_worker using (true);

create policy game_reveals_judge_worker_select
  on api.game_reveals for select to judge_worker using (true);

create policy revealed_key_points_judge_worker_select
  on api.revealed_key_points for select to judge_worker using (true);
