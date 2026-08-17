-- 075: PostHog is gone — analytics events now live in everything_events
-- (migration 077) and the dashboard reads Supabase directly. Remove the
-- posthog_reader role and the per-table read policies migration 070 created
-- for it. Guarded so this is a no-op on databases that never had the role
-- (e.g. fresh local stacks).

do $$
declare t record;
begin
  if not exists (select from pg_roles where rolname = 'posthog_reader') then
    return;
  end if;
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'everything\_%' escape '\'
  loop
    execute format('drop policy if exists posthog_reader_read on public.%I', t.tablename);
  end loop;
  drop owned by posthog_reader;
  drop role posthog_reader;
end $$;
