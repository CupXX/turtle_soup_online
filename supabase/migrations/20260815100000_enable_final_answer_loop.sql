-- Extend the least-privilege runtime roles for the final-answer and
-- end-game transactions. No role receives access to private answer text from
-- a public/browser path; only the Worker can select/update submissions.

grant insert on table private.final_answer_submissions to game_web;
grant select on table private.key_points to game_web;
grant update on table private.game_actions to game_web;
grant insert on table api.game_events, api.game_reveals, api.revealed_key_points to game_web;

create policy final_answer_submissions_game_web_insert
  on private.final_answer_submissions for insert to game_web with check (true);
create policy key_points_game_web_select
  on private.key_points for select to game_web using (true);
create policy actions_game_web_update
  on private.game_actions for update to game_web using (true) with check (true);
create policy game_events_game_web_insert
  on api.game_events for insert to game_web with check (true);
create policy game_reveals_game_web_insert
  on api.game_reveals for insert to game_web with check (true);
create policy revealed_key_points_game_web_insert
  on api.revealed_key_points for insert to game_web with check (true);

grant select, update on table private.final_answer_submissions to judge_worker;
grant insert on table api.game_events, api.game_reveals, api.revealed_key_points to judge_worker;

create policy final_answer_submissions_judge_worker_select
  on private.final_answer_submissions for select to judge_worker using (true);
create policy final_answer_submissions_judge_worker_update
  on private.final_answer_submissions for update to judge_worker using (true) with check (true);
create policy game_events_judge_worker_insert
  on api.game_events for insert to judge_worker with check (true);
create policy game_reveals_judge_worker_insert
  on api.game_reveals for insert to judge_worker with check (true);
create policy revealed_key_points_judge_worker_insert
  on api.revealed_key_points for insert to judge_worker with check (true);
