begin;
select plan(10);

select has_table('private', 'key_point_evidence'::name);
select has_column('private', 'key_point_evidence', 'key_point_id'::name);
select has_column('private', 'key_point_evidence', 'content'::name);
select has_column('private', 'question_judgments', 'current_established_evidence_ids'::name);
select has_column('private', 'challenge_judgments', 'established_evidence_ids'::name);
select has_index('private', 'key_point_evidence', 'key_point_evidence_key_point_id_idx'::name);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.key_point_evidence'::regclass),
  'RLS is enabled for private.key_point_evidence'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'private.key_point_evidence'::regclass),
  'RLS is forced for private.key_point_evidence'
);
select ok(has_table_privilege('judge_worker', 'private.key_point_evidence', 'SELECT'), 'worker can read Evidence');
select ok(has_table_privilege('judge_worker', 'private.key_point_evidence', 'INSERT'), 'worker can store Evidence');

select * from finish();
rollback;
