begin;

select plan(18);

select ok(has_schema_privilege('anon', 'api', 'USAGE'), 'anon can use the exposed api schema');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon cannot use the private schema');
select ok(has_table_privilege('anon', 'api.games', 'SELECT'), 'anon can read public games');
select ok(has_table_privilege('anon', 'api.messages', 'SELECT'), 'anon can read public messages');
select ok(not has_table_privilege('anon', 'api.games', 'INSERT'), 'anon cannot insert games');
select ok(not has_table_privilege('anon', 'api.games', 'UPDATE'), 'anon cannot update games');
select ok(not has_table_privilege('anon', 'api.games', 'DELETE'), 'anon cannot delete games');
select ok(not has_table_privilege('anon', 'private.game_secrets', 'SELECT'), 'anon cannot read stored solutions');

select ok(
  (select relrowsecurity from pg_class where oid = 'api.games'::regclass),
  'RLS is enabled for api.games'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'api.games'::regclass),
  'RLS is forced for api.games'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'api.game_reveals'::regclass),
  'RLS is enabled for api.game_reveals'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.game_secrets'::regclass),
  'RLS is enabled for private.game_secrets'
);

select ok(has_schema_privilege('game_web', 'private', 'USAGE'), 'web role can use private schema');
select ok(has_table_privilege('game_web', 'private.game_secrets', 'INSERT'), 'web role can store preparations');
select ok(has_table_privilege('judge_worker', 'private.game_actions', 'UPDATE'), 'worker role can lease actions');
select ok(has_table_privilege('judge_worker', 'api.messages', 'UPDATE'), 'worker role can publish verdicts');

select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'api'
      and tablename = 'games'
  ),
  'public games are in Realtime'
);
select ok(
  not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'private'
  ),
  'private tables are not in Realtime'
);

select * from finish();
rollback;
