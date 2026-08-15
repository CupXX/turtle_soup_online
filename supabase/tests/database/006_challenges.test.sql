begin;

select plan(18);

select has_enum('api', 'challenge_status'::name);
select enum_has_labels('api', 'challenge_status', array['NONE', 'PENDING', 'RESOLVED', 'FAILED']);
select has_table('private', 'question_judgments'::name);
select has_table('private', 'message_challenges'::name);
select has_table('private', 'challenge_judgments'::name);
select has_index('private', 'message_challenges', 'message_challenges_game_status_idx'::name);
select has_index('private', 'challenge_judgments', 'challenge_judgments_challenge_id_idx'::name);
select ok(has_column_privilege('game_web', 'api.messages', 'challenge_status', 'UPDATE'), 'challenge state is writable by the web role');
select ok(not has_column_privilege('game_web', 'api.messages', 'verdict', 'UPDATE'), 'verdict remains worker-only');

insert into api.games
  (id, status, puzzle_surface, key_point_total, discovered_key_point_count,
   total_question_count, created_at, activated_at, ended_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000601', 'ACTIVE', '质疑测试汤面', 1, 0, 1, now(), now(), null, now());

insert into api.players (id, display_nickname, lifetime_score, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000602', '质疑玩家', 0, now(), now());

insert into api.messages
  (id, game_id, player_id, sequence_no, content, status, verdict, awarded_points, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-000000000601',
   '00000000-0000-4000-8000-000000000602', 1, '是不是蚊子？', 'JUDGED', 'YES', 0, now(), now());

insert into private.question_judgments
  (message_id, game_id, player_id, original_verdict, original_covered_key_point_ids,
   current_verdict, current_covered_key_point_ids, prompt_version, schema_version)
values
  ('00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-000000000601',
   '00000000-0000-4000-8000-000000000602', 'YES', '{}', 'YES', '{}', 'question-judge-v6', 'judge-schema-v1');

insert into private.message_challenges
  (id, message_id, game_id, player_id, status, required_valid_judgments, valid_judgment_count)
values
  ('00000000-0000-4000-8000-000000000604', '00000000-0000-4000-8000-000000000603',
   '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000602', 'PENDING', 5, 0);
select is((select status::text from private.message_challenges where id = '00000000-0000-4000-8000-000000000604'), 'PENDING', 'challenge starts pending');
select is((select required_valid_judgments::integer from private.message_challenges where id = '00000000-0000-4000-8000-000000000604'), 5, 'challenge requires five valid judgments');
select is((select prompt_version from private.question_judgments where message_id = '00000000-0000-4000-8000-000000000603'), 'question-judge-v6', 'challenge eligibility retains the production prompt version');

update api.messages
set challenge_status = 'PENDING', updated_at = now()
where id = '00000000-0000-4000-8000-000000000603';
select is((select challenge_status::text from api.messages where id = '00000000-0000-4000-8000-000000000603'), 'PENDING', 'public message exposes pending challenge state');

insert into private.challenge_judgments
  (id, challenge_id, slot, provider, model, reasoning_effort, prompt_version, schema_version,
   verdict, covered_key_point_ids, valid, latency_ms, input_tokens, output_tokens)
values
  ('00000000-0000-4000-8000-000000000605', '00000000-0000-4000-8000-000000000604', 1,
   'openai-responses', 'gpt-5.6-luna', 'medium', 'question-judge-v6', 'judge-schema-v1',
   'YES', '{}', true, 120, 100, 40);
select is((select count(*)::integer from private.challenge_judgments where challenge_id = '00000000-0000-4000-8000-000000000604'), 1, 'fresh judgment audit row is stored');
select is((select model from private.challenge_judgments where challenge_id = '00000000-0000-4000-8000-000000000604' and slot = 1), 'gpt-5.6-luna', 'fresh judgment records model metadata');

select throws_ok(
  $$insert into private.challenge_judgments
    (id, challenge_id, slot, provider, model, reasoning_effort, prompt_version, schema_version,
     verdict, covered_key_point_ids, valid)
   values
    ('00000000-0000-4000-8000-000000000606', '00000000-0000-4000-8000-000000000604', 5,
     'openai-responses', 'gpt-5.6-luna', 'medium', 'question-judge-v6', 'judge-schema-v1',
     null, '{}', false)$$,
  '23514', null,
  'challenge slots are limited to four fresh judgments'
);

update private.message_challenges
set status = 'RESOLVED', valid_judgment_count = 5, resolved_verdict = 'YES', resolved_covered_key_point_ids = '{}', resolved_at = now()
where id = '00000000-0000-4000-8000-000000000604';
select is((select status::text from private.message_challenges where id = '00000000-0000-4000-8000-000000000604'), 'RESOLVED', 'challenge can be atomically resolved');
select is((select resolved_verdict::text from private.message_challenges where id = '00000000-0000-4000-8000-000000000604'), 'YES', 'challenge stores the reconciled verdict');

select * from finish();
rollback;
