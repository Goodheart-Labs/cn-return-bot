-- 102: the feed moves from one GitHub Actions run per post to a permanent
-- worker on the services machine (src/service/feed/main.ts, GOO-169).
--
-- Until now every feed run stored when the next run was due, and pg_cron
-- dispatched the Everything Priority Feeds workflow when that alarm came
-- (migration 098). The worker now paces itself by sleeping, so the alarm, its
-- table and its two functions go away. What the database keeps doing is start
-- the watchdog: a short GitHub run every half hour that fails when the
-- machine's services or either worker have stopped.
--
-- 1. everything_feed_worker: one row, the worker's heartbeat, stamped with
--    database time so that no two clocks are ever compared.
-- 2. The half-hourly watchdog dispatch, which replaces the alarm job.
-- 3. The alarm's table and functions are dropped.
--
-- Order on the day: apply this first, which stops new feed runs from being
-- dispatched; wait for a feed run that is still going to finish; merge; then
-- start cn-feed on the machine. Started earlier, the worker's start-up triage
-- would take that run's item for an orphan. Between this migration and the
-- merge the watchdog dispatch answers 404, which harms nothing.

-- ---------------------------------------------------------------------------
-- 1. The heartbeat.

create table everything_feed_worker (
  id      boolean primary key default true check (id),
  seen_at timestamptz not null
);

comment on table everything_feed_worker is
  'One row: when the feed worker on the services machine last went round its loop. It does so at least every five minutes. The watchdog run fails when this is more than two hours old.';

alter table everything_feed_worker enable row level security;

create or replace function everything_feed_worker_seen()
returns void
language sql
set search_path = public
as $$
  insert into everything_feed_worker (id, seen_at) values (true, now())
  on conflict (id) do update set seen_at = excluded.seen_at;
$$;

comment on function everything_feed_worker_seen() is
  'Stamps the feed worker''s heartbeat with the database clock. Service role only.';

create or replace function everything_feed_worker_silent_seconds()
returns int
language sql
stable
set search_path = public
as $$
  select extract(epoch from now() - seen_at)::int from everything_feed_worker where id;
$$;

comment on function everything_feed_worker_silent_seconds() is
  'Seconds since the feed worker''s last heartbeat, by the database clock. Null when it has never run. Service role only.';

revoke execute on function everything_feed_worker_seen() from public, anon, authenticated;
revoke execute on function everything_feed_worker_silent_seconds() from public, anon, authenticated;
grant execute on function everything_feed_worker_seen() to service_role;
grant execute on function everything_feed_worker_silent_seconds() to service_role;

-- ---------------------------------------------------------------------------
-- 2. The watchdog dispatch. Same PAT-in-Vault pattern as the create-notes
--    routine. :07 and :37 keep it off the minutes the X pipeline starts on.

select cron.unschedule('dispatch-everything-priority-feeds');

select cron.schedule(
  'dispatch-everything-feed-watchdog',
  '7,37 * * * *',
  $$
  select net.http_post(
    url     := 'https://api.github.com/repos/Goodheart-Labs/cn-return-bot/actions/workflows/everything-feed-watchdog.yml/dispatches',
    body    := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_pat'),
      'Accept',        'application/vnd.github+json',
      'Content-Type',  'application/json',
      'User-Agent',    'supabase-pg-cron'
    )
  );
  $$
);

-- ---------------------------------------------------------------------------
-- 3. The alarm is gone.

drop function everything_dispatch_feed_run_if_due();
drop function everything_set_feed_alarm(timestamptz, text);
drop table everything_feed_schedule;
