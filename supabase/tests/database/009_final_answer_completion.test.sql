begin;

select plan(12);

select ok(
  has_table_privilege('judge_worker', 'api.game_events', 'SELECT'),
  'worker can read final-answer events for conflict detection'
);
select ok(
  has_table_privilege('judge_worker', 'api.game_reveals', 'SELECT'),
  'worker can read final-answer reveals for conflict detection'
);
select ok(
  has_table_privilege('judge_worker', 'api.revealed_key_points', 'SELECT'),
  'worker can read revealed key points for conflict detection'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'api'
      and tablename = 'game_events'
      and policyname = 'game_events_judge_worker_select'
      and cmd = 'SELECT'
      and 'judge_worker' = any(roles)
  ),
  'worker has an RLS select policy for final-answer events'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'api'
      and tablename = 'game_reveals'
      and policyname = 'game_reveals_judge_worker_select'
      and cmd = 'SELECT'
      and 'judge_worker' = any(roles)
  ),
  'worker has an RLS select policy for final-answer reveals'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'api'
      and tablename = 'revealed_key_points'
      and policyname = 'revealed_key_points_judge_worker_select'
      and cmd = 'SELECT'
      and 'judge_worker' = any(roles)
  ),
  'worker has an RLS select policy for revealed key points'
);
select ok(
  has_table_privilege('judge_worker', 'api.game_events', 'INSERT'),
  'worker retains event INSERT for final-answer completion'
);
select ok(
  has_table_privilege('judge_worker', 'api.game_reveals', 'INSERT'),
  'worker retains reveal INSERT for final-answer completion'
);
select ok(
  has_table_privilege('judge_worker', 'api.revealed_key_points', 'INSERT'),
  'worker retains key-point INSERT for final-answer completion'
);
select ok(
  not has_table_privilege('judge_worker', 'api.game_events', 'UPDATE'),
  'worker does not receive unrelated event UPDATE access'
);
select ok(
  not has_table_privilege('judge_worker', 'api.game_reveals', 'UPDATE'),
  'worker does not receive unrelated reveal UPDATE access'
);
select ok(
  not has_table_privilege('judge_worker', 'api.revealed_key_points', 'UPDATE'),
  'worker does not receive unrelated key-point UPDATE access'
);

select * from finish();
rollback;
