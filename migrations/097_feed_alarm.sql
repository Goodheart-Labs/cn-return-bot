-- 097: start each feed run when the previous run said the next one is due,
-- instead of on a fixed timer.
--
-- Since migration 071 pg_cron dispatched the Everything Priority Feeds
-- workflow at :03 and :33 whatever the pipeline was doing. Now every run
-- computes when the next feed post should start (src/everything/pacing.ts:
-- hours left in the UTC day times the mean cost of a recent post divided by
-- the money left) and stores that time here as an alarm. pg_cron checks the
-- alarm once a minute and dispatches a run when it has come. The rule lives
-- only in the pipeline code; the database is a plain alarm clock.
--
-- 1. everything_feed_schedule: one row holding the alarm, why it was set to
--    that time, and when a run was last dispatched.
-- 2. everything_set_feed_alarm: what the run calls at its end.
-- 3. everything_dispatch_feed_run_if_due: what pg_cron calls every minute.
--    It also carries the backstop: a run that never set its alarm (it
--    crashed before that point, or GitHub dropped the dispatch) would
--    otherwise leave the pipeline asleep, so 45 minutes after a dispatch with
--    no alarm set since, it dispatches again. During a post longer than 45
--    minutes that starts a second run, which queues behind the first in the
--    workflow's concurrency group and then processes one post ahead of
--    schedule; the next alarm absorbs that.
-- 4. The cron job, under the same name as before so it replaces the fixed
--    timer, plus a nightly cleanup of pg_cron's own history, which a
--    once-a-minute job would otherwise grow by 1440 rows a day.

-- ---------------------------------------------------------------------------
-- 1. The alarm.

create table everything_feed_schedule (
  id              boolean primary key default true check (id),
  next_run_at     timestamptz,
  next_run_reason text check (next_run_reason in ('interval', 'midnight', 'idle')),
  dispatched_at   timestamptz
);

comment on table everything_feed_schedule is
  'One row: when the next feed run is due (the alarm the previous run set), why, and when pg_cron last dispatched one. next_run_at is null from dispatch until the run sets the next alarm.';
comment on column everything_feed_schedule.next_run_reason is
  'interval: one pacing interval after the last post started. midnight: the money left does not cover one average post. idle: the run found nothing to process.';

alter table everything_feed_schedule enable row level security;
insert into everything_feed_schedule (id) values (true);

-- ---------------------------------------------------------------------------
-- 2. Setting the alarm. Clearing dispatched_at says the dispatched run has
--    reported back, which is what the backstop waits for.

create or replace function everything_set_feed_alarm(next_at timestamptz, reason text)
returns void
language sql
set search_path = public
as $$
  insert into everything_feed_schedule (id, next_run_at, next_run_reason, dispatched_at)
  values (true, next_at, reason, null)
  on conflict (id) do update
    set next_run_at = excluded.next_run_at,
        next_run_reason = excluded.next_run_reason,
        dispatched_at = null;
$$;

comment on function everything_set_feed_alarm(timestamptz, text) is
  'Sets when the next feed run is due. The feed run calls it at its end. Service role only.';

revoke execute on function everything_set_feed_alarm(timestamptz, text) from public, anon, authenticated;
grant execute on function everything_set_feed_alarm(timestamptz, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Dispatching when due. Returns whether it dispatched, so the cron
--    history says what each tick did.

create or replace function everything_dispatch_feed_run_if_due()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  -- How long a dispatched run may go without setting its alarm before
  -- another run is dispatched. Longer than any run's setup, shorter than
  -- most long posts is not the goal: the goal is that a crashed run costs at
  -- most this much silence.
  backstop constant interval := interval '45 minutes';
  due boolean;
begin
  select (next_run_at is not null and next_run_at <= now())
      or (next_run_at is null and (dispatched_at is null or dispatched_at < now() - backstop))
    into due
    from everything_feed_schedule
   where id;
  if not coalesce(due, false) then
    return false;
  end if;
  update everything_feed_schedule set next_run_at = null, dispatched_at = now() where id;
  perform net.http_post(
    url     := 'https://api.github.com/repos/Goodheart-Labs/cn-return-bot/actions/workflows/everything-priority-feeds.yml/dispatches',
    body    := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_pat'),
      'Accept',        'application/vnd.github+json',
      'Content-Type',  'application/json',
      'User-Agent',    'supabase-pg-cron'
    )
  );
  return true;
end;
$$;

comment on function everything_dispatch_feed_run_if_due() is
  'Dispatches the Everything Priority Feeds workflow when the alarm has come, or 45 minutes after a dispatch whose run never set the next alarm. Called by pg_cron every minute; nobody else may call it.';

-- Nobody but the owner, which is what pg_cron runs as. It reads the Vault.
revoke execute on function everything_dispatch_feed_run_if_due() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The timer. 3-arg cron.schedule upserts by job name, so this replaces the
--    fixed :03/:33 job from migration 071 and re-running is safe.

select cron.schedule(
  'dispatch-everything-priority-feeds',
  '* * * * *',
  $$ select everything_dispatch_feed_run_if_due(); $$
);

select cron.schedule(
  'cleanup-cron-history',
  '17 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days'; $$
);

-- Verification (run ad hoc in the SQL editor):
--
--   select jobid, schedule, active, command from cron.job where jobname in ('dispatch-everything-priority-feeds', 'cleanup-cron-history');
--   select * from everything_feed_schedule;
--
--   -- what the last ticks did (true = dispatched)
--   select start_time, return_message from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'dispatch-everything-priority-feeds')
--   order by start_time desc limit 10;
--
-- To stop dispatching: select cron.unschedule('dispatch-everything-priority-feeds');
