-- 196: two X notewriter accounts side by side (GOO-851).
--
-- Our notes on X went out from one account until now, X's
-- wholesome-raspberry-stilt. The WSDM Cup account joins it, written by the
-- cn-x-watch daemon on the services box (src/x-watch/). Each row of
-- pipeline_runs and notes now says which account it belongs to. Every existing row belongs to the first account, `stilt`, which
-- is also the default, so the X run, the feedback job and the Signal bot write
-- correct rows without a change. src/api/xAccount.ts lists the accounts.
--
-- The writing limit belongs to an account. X counts each account's notes on
-- its own, so the submission capacity of the first account must not count the
-- new account's notes. The capacity functions of migration 100 therefore count
-- only `stilt` notes now. The new account does not use them or their claims:
-- cn-x-watch is its only writer and keeps its own count. So every claim in
-- note_submission_claims belongs to the first account.
--
-- Adding a column with a constant default changes no stored row. The checks
-- are added as NOT VALID and validated afterwards, so validating reads the
-- tables without blocking writes.
--
-- Apply this before the PR is merged, because the X run filters on the new
-- columns from then on.

alter table public.pipeline_runs add column x_account text not null default 'stilt';
alter table public.notes add column x_account text not null default 'stilt';

alter table public.pipeline_runs add constraint pipeline_runs_x_account_check check (x_account in ('stilt', 'wsdm')) not valid;
alter table public.notes add constraint notes_x_account_check check (x_account in ('stilt', 'wsdm')) not valid;
alter table public.pipeline_runs validate constraint pipeline_runs_x_account_check;
alter table public.notes validate constraint notes_x_account_check;

-- The rows of every account but the first are few. cn-x-watch looks up which
-- feed posts its account already handled, and the X run looks up which of its
-- feed posts only another account handled. Both read this small index.
create index pipeline_runs_other_accounts_idx on public.pipeline_runs (tweet_id, x_account) where x_account <> 'stilt';

-- The capacity of migration 100, counting only the first account's notes. The
-- body is unchanged except for the two `x_account = 'stilt'` conditions.
create or replace function public.get_note_submission_capacity()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_used bigint;
  v_pending bigint;
  v_expiries timestamptz[];
  v_cap bigint;
  v_stored bigint;
  v_hit bigint;
  v_hit_at timestamptz;
  v_raw text;
  v_binding boolean := false;
  v_can_submit boolean := true;
  v_probe boolean := false;
  v_next timestamptz;
  v_cooldown timestamptz;
  v_queued bigint;
begin
  -- Count accepted-but-unlogged notes once. Uncertain outcomes occupy a slot
  -- for 24h; abandoned claimed requests remain occupied until reconciled.
  with unrecorded_claims as (
    select c.* from public.note_submission_claims c
    where not exists (select 1 from public.notes n where n.x_account = 'stilt' and (
      (c.note_id is not null and n.note_id = c.note_id and
        n.submitted_at > v_now - interval '24 hours') or
      (c.note_id is null and n.tweet_id = c.tweet_id and n.submitted_at is not null)))
  ), occupied as (
    select false as pending, submitted_at + interval '24 hours' as expires_at
      from public.notes where x_account = 'stilt' and submitted_at > v_now - interval '24 hours'
    union all
    select status <> 'submitted', case when status = 'claimed' then null
      else resolved_at + interval '24 hours' end
      from unrecorded_claims where status = 'claimed' or
        (status in ('submitted', 'uncertain') and resolved_at > v_now - interval '24 hours')
  )
  select count(*) filter (where not pending), count(*) filter (where pending),
    array_agg(expires_at order by expires_at) filter (where expires_at is not null)
    into v_used, v_pending, v_expiries from occupied;

  select value into v_raw from public.pipeline_state where key = 'writing_limit';
  if v_raw is not null then
    if v_raw !~ '^[0-9]{1,9}$' then raise exception 'Invalid writing_limit state'; end if;
    v_stored := v_raw::bigint;
  end if;
  select value into v_raw from public.pipeline_state where key = 'limit_hit_value';
  if v_raw is not null then
    if v_raw !~ '^[0-9]{1,9}$' then raise exception 'Invalid limit_hit_value state'; end if;
    v_hit := v_raw::bigint;
  end if;
  select value into v_raw from public.pipeline_state where key = 'limit_hit_at';
  if v_raw is not null then
    begin
      v_hit_at := v_raw::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Invalid limit_hit_at state';
    end;
    if not isfinite(v_hit_at) or v_hit_at > v_now then
      raise exception 'Invalid limit_hit_at state';
    end if;
  end if;
  if (v_hit is null) <> (v_hit_at is null) then
    raise exception 'Incomplete writing-limit observation';
  end if;

  -- Estimates never veto a request. Only a real rejection binds; a later
  -- successful probe (not a reconciliation of an older request) releases it.
  v_binding := v_hit_at is not null and v_used <= v_hit and not exists (
    select 1 from public.note_submission_claims where is_probe and status = 'submitted'
      and claimed_at > v_hit_at and resolved_at > v_hit_at
  );
  v_cap := case when v_binding then v_hit else v_stored end;
  if v_binding and v_used + v_pending >= v_hit then
    v_cooldown := v_hit_at + interval '95 minutes';
    v_probe := v_now >= v_cooldown;
    v_can_submit := v_probe and v_pending = 0;
    if not v_can_submit then
      -- Enough expiring submissions must leave one slot, including any
      -- pending claims. A claimed request has no automatic expiry.
      v_next := v_expiries[(v_used + v_pending - v_hit + 1)::integer];
      if v_pending = 0 and (v_next is null or v_cooldown < v_next) then
        v_next := v_cooldown;
      end if;
    end if;
  end if;
  select count(*) into v_queued from public.signal_submission_queue;
  return jsonb_build_object('cap', v_cap, 'used24h', v_used, 'inFlight', v_pending,
    'remaining', case when v_cap is null then null else greatest(0, v_cap - v_used - v_pending) end,
    'reserve', 0, 'canSubmit', v_can_submit, 'probe', v_probe,
    'signalQueued', v_queued, 'nextAttemptAt', v_next);
end;
$$;

-- The claim of migration 100. A note of the new account on the same tweet no
-- longer makes the first account's claim busy.
create or replace function public.claim_note_submission(p_tweet_id text, p_lane text default 'automatic')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_capacity jsonb;
  v_existing text;
  v_first text;
  v_id uuid;
begin
  if p_tweet_id is null or p_tweet_id !~ '^[0-9]+$' then
    raise exception 'A numeric tweet ID is required';
  end if;
  if p_lane is null or p_lane not in ('automatic', 'signal') then
    raise exception 'Unknown submission lane';
  end if;
  perform pg_advisory_xact_lock(792634018153::bigint);
  v_capacity := public.get_note_submission_capacity();
  if exists (select 1 from public.notes where x_account = 'stilt' and tweet_id = p_tweet_id and submitted_at is not null) then
    v_existing := 'submitted';
  else
    select status into v_existing from public.note_submission_claims
      where tweet_id = p_tweet_id and status <> 'rejected';
  end if;
  if v_existing is not null then
    if v_existing in ('submitted', 'uncertain') then
      delete from public.signal_submission_queue where tweet_id = p_tweet_id;
    end if;
    return jsonb_build_object('status', 'submission_busy', 'reason', v_existing, 'capacity', v_capacity);
  end if;
  select tweet_id into v_first from public.signal_submission_queue order by queued_at, tweet_id limit 1;
  if v_first is not null and (p_lane = 'automatic' or p_tweet_id <> v_first) then
    return jsonb_build_object('status', 'capacity_reserved', 'reason', 'signal_priority', 'capacity', v_capacity);
  end if;
  if not (v_capacity ->> 'canSubmit')::boolean then
    return jsonb_build_object('status', 'capacity_reserved', 'reason',
      case when (v_capacity ->> 'probe')::boolean and (v_capacity ->> 'inFlight')::bigint > 0
        then 'probe_in_flight' else 'capacity_exhausted' end, 'capacity', v_capacity);
  end if;
  insert into public.note_submission_claims (tweet_id, lane, is_probe)
    values (p_tweet_id, p_lane, (v_capacity ->> 'probe')::boolean) returning id into v_id;
  return jsonb_build_object('status', 'claimed', 'claimId', v_id, 'capacity', v_capacity);
end;
$$;

-- The Signal queue of migration 100, with the same change as the claim.
create or replace function public.queue_signal_submission(p_tweet_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_existing text;
begin
  if p_tweet_id is null or p_tweet_id !~ '^[0-9]+$' then
    raise exception 'A numeric tweet ID is required';
  end if;
  perform pg_advisory_xact_lock(792634018153::bigint);
  if exists (select 1 from public.notes where x_account = 'stilt' and tweet_id = p_tweet_id and submitted_at is not null) then
    v_existing := 'submitted';
  else
    select status into v_existing from public.note_submission_claims
      where tweet_id = p_tweet_id and status <> 'rejected';
  end if;
  if v_existing is not null then
    delete from public.signal_submission_queue where tweet_id = p_tweet_id;
    return jsonb_build_object('status', 'submission_busy', 'reason', v_existing,
      'capacity', public.get_note_submission_capacity());
  end if;
  insert into public.signal_submission_queue (tweet_id) values (p_tweet_id)
    on conflict (tweet_id) do nothing;
  return jsonb_build_object('status', 'queued');
end;
$$;

notify pgrst, 'reload schema';
