-- The feed run is dispatched only while the pipeline takes feed posts
-- (GOO-791). Since migration 184 the feed run does one thing: it checks one
-- post as the notewriter `pipeline` of API v1. cn-walk on the services box
-- adds the posts and watches the notewriters, which the feed run used to do.
-- So while the pipeline takes no feed posts, as since 2026-10-21, pg_cron
-- dispatches nothing, and no run turns red every 45 minutes either.
--
-- `bun run notewriter subscribe pipeline <minutes>` switches the runs back
-- on: the next tick finds the alarm long due and dispatches at once.
--
-- ORDER: apply once cn-walk runs on the services box. Until then the old feed
-- run's walk keeps posts waiting for the v1 runners.
-- UNDO: re-run section 3 of migration 098.

create or replace function everything_dispatch_feed_run_if_due()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  -- How long a dispatched run may go without setting its alarm before
  -- another run is dispatched. The goal is that a crashed run costs at most
  -- this much silence.
  backstop constant interval := interval '45 minutes';
  due boolean;
begin
  if not exists (select 1 from everything_notewriters where id = 'pipeline' and every_minutes is not null and disabled_at is null) then
    return false;
  end if;
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
  'Dispatches the Everything Priority Feeds workflow when the alarm has come, or 45 minutes after a dispatch whose run never set the next alarm, and only while the notewriter pipeline takes feed posts (GOO-791). Called by pg_cron every minute; nobody else may call it.';

revoke execute on function everything_dispatch_feed_run_if_due() from public, anon, authenticated, service_role;
