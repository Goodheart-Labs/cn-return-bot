-- A miniature of what migration 098 touches: the roles, and stand-ins for the
-- three things the throwaway database does not have, pg_net, pg_cron and the
-- Vault. Each stand-in records what it was asked to do in a table, so the
-- checks can read back which dispatches were sent and which jobs registered.
--
-- How to run it, from the repo root (the recipe from migrations/README_086.md):
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   until sudo docker exec cn-migration-test pg_isready -U postgres; do sleep 1; done
--   export PGPASSWORD=test
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
--   $PSQL -f migrations/098_feed_alarm.fixture.sql
--   $PSQL --single-transaction -f migrations/098_feed_alarm.sql
--   psql -h 127.0.0.1 -p 55432 -U postgres -q -f migrations/098_feed_alarm.verify.sql
--   sudo docker stop cn-migration-test
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- pg_net: the same signature as net.http_post, recording every call.
create schema net;
create table net.sent (id serial primary key, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$
  insert into net.sent (url, body, headers) values (url, body, headers) returning id::bigint;
$$;

-- pg_cron: the 3-arg cron.schedule that upserts by job name.
create schema cron;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid::bigint;
$$;
-- The job as migration 071 left it, so the check can prove it was replaced.
select cron.schedule('dispatch-everything-priority-feeds', '3,33 * * * *', 'select net.http_post(...)');

-- The Vault, holding the token the dispatch sends.
create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('github_dispatch_pat', 'pat-for-the-test');

-- Supabase grants the service role every table; the fixture has to do it by hand.
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
