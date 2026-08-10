-- 070: let the posthog_reader role actually read the everything_* tables.
-- The role itself is created outside migrations (it carries a password); it has
-- SELECT grants, but every everything_* table has RLS enabled, so without a
-- policy the role sees zero rows. One permissive read-all policy per table.
-- Guarded so the migration is a no-op on databases without the role.
do $$
declare t record;
begin
  if not exists (select from pg_roles where rolname = 'posthog_reader') then
    return;
  end if;
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'everything\_%' escape '\'
  loop
    execute format('create policy posthog_reader_read on public.%I for select to posthog_reader using (true)', t.tablename);
  end loop;
end
$$;
