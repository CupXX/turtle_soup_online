begin;

select plan(12);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'api'
      and tablename = 'games'
      and indexname = 'games_single_open_idx'
      and indexdef like '%WHERE%'
  ),
  'at most one WAITING or ACTIVE game is allowed'
);

insert into api.games
  (id, status, puzzle_surface, key_point_total, discovered_key_point_count,
   total_question_count, created_at, activated_at, ended_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000101', 'WAITING', null, 0, 0, 0, now(), null, null, now());

insert into private.game_secrets
  (game_id, puzzle_surface, full_solution, input_version, updated_at)
values
  ('00000000-0000-4000-8000-000000000101', '表面版本一', '完整真相版本一', 1, now());

insert into private.key_point_extraction_jobs
  (id, game_id, input_version, status, attempt_count, next_attempt_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', 1, 'PENDING', 0, now(), now(), now());

select is(
  (select status::text from api.games where id = '00000000-0000-4000-8000-000000000101'),
  'WAITING',
  'preparation starts in WAITING'
);

select is(
  (select input_version from private.game_secrets where game_id = '00000000-0000-4000-8000-000000000101'),
  1,
  'the first secret version is stored privately'
);

update private.game_secrets
set puzzle_surface = '表面版本二',
    full_solution = '完整真相版本二',
    input_version = 2,
    updated_at = now()
where game_id = '00000000-0000-4000-8000-000000000101';

insert into private.key_point_extraction_jobs
  (id, game_id, input_version, status, attempt_count, next_attempt_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000101', 2, 'PENDING', 0, now(), now(), now());

select is(
  (select count(*)::integer
   from private.key_point_extraction_jobs jobs
   join api.games games on games.id = jobs.game_id
   join private.game_secrets secrets
     on secrets.game_id = jobs.game_id
    and secrets.input_version = jobs.input_version
   where jobs.id = '00000000-0000-4000-8000-000000000102'
     and games.status = 'WAITING'),
  0,
  'a stale extraction version is not eligible to activate the game'
);

insert into private.key_points (id, game_id, ordinal, content, created_at)
values
  ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000101', 1, '线索一', now()),
  ('00000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-000000000101', 2, '线索二', now()),
  ('00000000-0000-4000-8000-000000000113', '00000000-0000-4000-8000-000000000101', 3, '线索三', now());

update api.games
set status = 'ACTIVE',
    puzzle_surface = (select puzzle_surface from private.game_secrets where game_id = api.games.id),
    key_point_total = (select count(*)::smallint from private.key_points where game_id = api.games.id),
    discovered_key_point_count = 0,
    activated_at = now(),
    updated_at = now()
where id = '00000000-0000-4000-8000-000000000101';

update private.key_point_extraction_jobs
set status = 'COMPLETED', updated_at = now()
where id = '00000000-0000-4000-8000-000000000103';

select is(
  (select status::text from api.games where id = '00000000-0000-4000-8000-000000000101'),
  'ACTIVE',
  'successful extraction activates the game'
);
select is(
  (select puzzle_surface from api.games where id = '00000000-0000-4000-8000-000000000101'),
  '表面版本二',
  'activation publishes only the puzzle surface'
);
select is(
  (select key_point_total from api.games where id = '00000000-0000-4000-8000-000000000101'),
  3::smallint,
  'activation publishes the extracted key-point count'
);
select is(
  (select discovered_key_point_count from api.games where id = '00000000-0000-4000-8000-000000000101'),
  0::smallint,
  'activation resets discovered key-point progress'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'api' and table_name = 'games' and column_name = 'full_solution'
  ),
  'the full solution is not published in api.games'
);
select ok(
  exists (
    select 1
    from private.key_points
    where game_id = '00000000-0000-4000-8000-000000000101' and content = '线索一'
  ),
  'key-point text remains in the private schema'
);

select throws_ok(
  $$update private.key_points set content = '修改后的线索' where id = '00000000-0000-4000-8000-000000000111'$$,
  'key points are immutable after activation',
  'active key points reject UPDATE'
);
select throws_ok(
  $$delete from private.key_points where id = '00000000-0000-4000-8000-000000000111'$$,
  'key points are immutable after activation',
  'active key points reject DELETE'
);

select * from finish();
rollback;
