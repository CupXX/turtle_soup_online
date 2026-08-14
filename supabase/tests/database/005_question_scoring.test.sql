begin;

select plan(12);

insert into api.games
  (id, status, puzzle_surface, key_point_total, discovered_key_point_count,
   total_question_count, created_at, activated_at, ended_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000301', 'ACTIVE', '评分测试表面', 3, 0, 2, now(), now(), null, now());

insert into api.players (id, display_nickname, lifetime_score, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000302', '评分玩家', 0, now(), now());

insert into api.game_player_stats (game_id, player_id, question_count, yes_count, updated_at)
values ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302', 2, 0, now());

insert into private.key_points (id, game_id, ordinal, content, created_at)
values
  ('00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000301', 1, '评分线索一', now()),
  ('00000000-0000-4000-8000-000000000312', '00000000-0000-4000-8000-000000000301', 2, '评分线索二', now()),
  ('00000000-0000-4000-8000-000000000313', '00000000-0000-4000-8000-000000000301', 3, '评分线索三', now());

insert into api.messages
  (id, game_id, player_id, sequence_no, content, status, verdict, awarded_points, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000321', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302', 1, '第一个问题', 'PENDING', null, 0, now(), now()),
  ('00000000-0000-4000-8000-000000000322', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302', 2, '第二个问题', 'PENDING', null, 0, now(), now());

insert into private.key_point_claims (key_point_id, game_id, message_id, player_id, claimed_at)
values ('00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000321', '00000000-0000-4000-8000-000000000302', now());
update api.players set lifetime_score = lifetime_score + 1 where id = '00000000-0000-4000-8000-000000000302';
update api.games set discovered_key_point_count = discovered_key_point_count + 1 where id = '00000000-0000-4000-8000-000000000301' and status = 'ACTIVE';
update api.messages set status = 'JUDGED', verdict = 'YES', awarded_points = 1, judged_at = now(), updated_at = now() where id = '00000000-0000-4000-8000-000000000321' and status = 'PENDING';
update api.game_player_stats set yes_count = yes_count + 1, updated_at = now() where game_id = '00000000-0000-4000-8000-000000000301' and player_id = '00000000-0000-4000-8000-000000000302';

select is((select lifetime_score from api.players where id = '00000000-0000-4000-8000-000000000302'), 1, 'a first claim awards one lifetime point');
select is((select discovered_key_point_count from api.games where id = '00000000-0000-4000-8000-000000000301'), 1::smallint, 'a first claim advances discovery once');
select is((select awarded_points from api.messages where id = '00000000-0000-4000-8000-000000000321'), 1::smallint, 'YES publishes the number of new claims');
select is((select yes_count from api.game_player_stats where game_id = '00000000-0000-4000-8000-000000000301' and player_id = '00000000-0000-4000-8000-000000000302'), 1, 'YES increments the hit-rate numerator');

insert into private.key_point_claims (key_point_id, game_id, message_id, player_id, claimed_at)
values ('00000000-0000-4000-8000-000000000312', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000322', '00000000-0000-4000-8000-000000000302', now())
on conflict (key_point_id) do nothing;
update api.players set lifetime_score = lifetime_score + 1 where id = '00000000-0000-4000-8000-000000000302';
update api.games set discovered_key_point_count = discovered_key_point_count + 1 where id = '00000000-0000-4000-8000-000000000301' and status = 'ACTIVE';
update api.messages set status = 'JUDGED', verdict = 'BOTH', awarded_points = 1, judged_at = now(), updated_at = now() where id = '00000000-0000-4000-8000-000000000322' and status = 'PENDING';

select is((select lifetime_score from api.players where id = '00000000-0000-4000-8000-000000000302'), 2, 'a second first claim awards one more point');
select is((select discovered_key_point_count from api.games where id = '00000000-0000-4000-8000-000000000301'), 2::smallint, 'BOTH preserves discovery progress for valid claims');
select is((select awarded_points from api.messages where id = '00000000-0000-4000-8000-000000000322'), 1::smallint, 'BOTH publishes newly claimed points');
select is((select yes_count from api.game_player_stats where game_id = '00000000-0000-4000-8000-000000000301' and player_id = '00000000-0000-4000-8000-000000000302'), 1, 'BOTH does not increment yes_count');
select is((select question_count from api.game_player_stats where game_id = '00000000-0000-4000-8000-000000000301' and player_id = '00000000-0000-4000-8000-000000000302'), 2, 'judging does not double-count receipt questions');
select is((select count(*) from private.key_point_claims where game_id = '00000000-0000-4000-8000-000000000301'), 2::bigint, 'repeated claims remain first-owner unique');

update api.games
set status = 'ENDED', ended_at = now(), end_reason = 'FORCE_ENDED', updated_at = now()
where id = '00000000-0000-4000-8000-000000000301';
insert into api.messages
  (id, game_id, player_id, sequence_no, content, status, verdict, awarded_points, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000323', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302', 3, '结束后的问题', 'PENDING', null, 0, now(), now());
update api.games set discovered_key_point_count = discovered_key_point_count + 1 where id = '00000000-0000-4000-8000-000000000301' and status = 'ACTIVE';
update api.messages set status = 'JUDGED', verdict = 'YES', awarded_points = 1 where id = '00000000-0000-4000-8000-000000000323' and status = 'PENDING' and exists (select 1 from api.games where id = '00000000-0000-4000-8000-000000000301' and status = 'ACTIVE');

select is((select discovered_key_point_count from api.games where id = '00000000-0000-4000-8000-000000000301'), 2::smallint, 'an ended-game race cannot advance discovery');
select is((select status::text from api.messages where id = '00000000-0000-4000-8000-000000000323'), 'PENDING', 'an ended-game race leaves the message pending');

select * from finish();
rollback;
