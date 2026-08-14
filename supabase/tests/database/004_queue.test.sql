begin;

select plan(5);

insert into api.games
  (id, status, puzzle_surface, key_point_total, discovered_key_point_count,
   total_question_count, created_at, activated_at, ended_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000201', 'ACTIVE', '队列测试表面', 3, 0, 0, now(), now(), null, now());

insert into api.players (id, display_nickname, lifetime_score, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000202', '队列玩家', 0, now(), now());

insert into private.game_actions
  (id, game_id, player_id, sequence_no, action_type, status, attempt_count,
   next_attempt_at, idempotency_key, payload_digest, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202', 1, 'NORMAL_MESSAGE', 'PENDING', 0, now(), '00000000-0000-4000-8000-000000000221', 'd1', now(), now()),
  ('00000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202', 2, 'NORMAL_MESSAGE', 'PENDING', 0, now(), '00000000-0000-4000-8000-000000000222', 'd2', now(), now()),
  ('00000000-0000-4000-8000-000000000213', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202', 3, 'NORMAL_MESSAGE', 'PROCESSING', 1, now(), '00000000-0000-4000-8000-000000000223', 'd3', now(), now()),
  ('00000000-0000-4000-8000-000000000214', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202', 4, 'NORMAL_MESSAGE', 'BLOCKED', 4, now(), '00000000-0000-4000-8000-000000000224', 'd4', now(), now());

select is(
  (select sequence_no
   from private.game_actions actions
   where actions.game_id = '00000000-0000-4000-8000-000000000201'
     and actions.status in ('PENDING', 'RETRY')
     and actions.attempt_count < 4
     and not exists (
       select 1 from private.game_actions earlier
       where earlier.game_id = actions.game_id
         and earlier.sequence_no < actions.sequence_no
         and earlier.status not in ('COMPLETED', 'CANCELLED')
     )
   order by sequence_no
   limit 1),
  1::bigint,
  'the smallest pending sequence is the only queue head'
);

update private.game_actions
set status = 'BLOCKED', lease_owner = null, lease_expires_at = null
where id = '00000000-0000-4000-8000-000000000211';

select is(
  (select count(*)::integer
   from private.game_actions actions
   where actions.game_id = '00000000-0000-4000-8000-000000000201'
     and actions.status in ('PENDING', 'RETRY')
     and actions.attempt_count < 4
     and not exists (
       select 1 from private.game_actions earlier
       where earlier.game_id = actions.game_id
         and earlier.sequence_no < actions.sequence_no
         and earlier.status not in ('COMPLETED', 'CANCELLED')
     )),
  0,
  'a blocked head cannot be overtaken'
);

update private.game_actions
set status = 'PROCESSING', attempt_count = 1,
    lease_owner = 'worker-1', lease_expires_at = now() - interval '1 second'
where id = '00000000-0000-4000-8000-000000000211';

select is(
  (select sequence_no
   from private.game_actions actions
   where actions.game_id = '00000000-0000-4000-8000-000000000201'
     and actions.attempt_count < 4
     and (actions.status in ('PENDING', 'RETRY') or (actions.status = 'PROCESSING' and actions.lease_expires_at <= now()))
     and not exists (
       select 1 from private.game_actions earlier
       where earlier.game_id = actions.game_id
         and earlier.sequence_no < actions.sequence_no
         and earlier.status not in ('COMPLETED', 'CANCELLED')
     )
   order by sequence_no
   limit 1),
  1::bigint,
  'an expired lease makes the same head reclaimable'
);

update private.game_actions
set lease_expires_at = now() + interval '1 minute'
where id = '00000000-0000-4000-8000-000000000211';

select is(
  (select count(*)::integer
   from private.game_actions actions
   where actions.game_id = '00000000-0000-4000-8000-000000000201'
     and actions.status = 'PROCESSING'
     and actions.lease_expires_at > now()
     and not exists (
       select 1 from private.game_actions earlier
       where earlier.game_id = actions.game_id
         and earlier.sequence_no < actions.sequence_no
         and earlier.status not in ('COMPLETED', 'CANCELLED')
     )),
  1,
  'a live lease keeps the head owned'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'private.game_actions'::regclass
      and contype = 'u'
      and conname = 'game_actions_sequence_unique'
  ),
  'one action owns each game sequence number'
);

select * from finish();
rollback;
