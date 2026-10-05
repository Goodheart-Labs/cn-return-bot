-- Checks for migration 111. Run it after the migration, inside a transaction
-- that must not commit. The block ends by raising an error that carries every
-- result, so whatever it created is always rolled back.
do $$
declare
  existing uuid := (select id from everything_projects where slug = 'verysane');
  by_case uuid;
  created uuid;
  again uuid;
  new_row everything_projects%rowtype;
  invalid_refused boolean := false;
  anon_refused boolean := false;
begin
  set local role authenticated;
  by_case := everything_creator_project('https://VerySane.substack.com/');
  created := everything_creator_project('https://www.youtube.com/@goo290ProbeChannel');
  again := everything_creator_project('https://www.youtube.com/@goo290probechannel');
  begin
    perform everything_creator_project('https://example.com/');
  exception when check_violation then
    invalid_refused := true;
  end;
  reset role;
  set local role anon;
  begin
    perform everything_creator_project('https://verysane.substack.com');
  exception when insufficient_privilege then
    anon_refused := true;
  end;
  reset role;
  select * into new_row from everything_projects where id = created;
  raise exception 'RESULT %', json_build_object(
    'existing_found_ignoring_case', by_case = existing,
    'same_creator_twice_one_project', created = again,
    'new_slug', new_row.slug,
    'new_name', new_row.name,
    'new_has_no_priority', new_row.priority_until is null,
    'invalid_feed_refused', invalid_refused,
    'anon_refused', anon_refused
  );
end;
$$;
