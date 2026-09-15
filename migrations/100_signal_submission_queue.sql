-- Signal keeps approved text locally; this table only coordinates priority.
create table public.signal_submission_queue (
  tweet_id text primary key check (tweet_id ~ '^[0-9]+$'),
  queued_at timestamptz not null default clock_timestamp()
);
create index signal_submission_queue_order_idx
  on public.signal_submission_queue (queued_at, tweet_id);
alter table public.signal_submission_queue enable row level security;
revoke all on public.signal_submission_queue from public, anon, authenticated;
grant select, insert, update, delete on public.signal_submission_queue to service_role;
grant select, insert, update on public.pipeline_state to service_role;

alter table public.note_submission_claims
  add column is_probe boolean not null default false;

create function public.queue_signal_submission(p_tweet_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_existing text;
begin
  if p_tweet_id is null or p_tweet_id !~ '^[0-9]+$' then
    raise exception 'A numeric tweet ID is required';
  end if;
  perform pg_advisory_xact_lock(792634018153::bigint);
  if exists (select 1 from public.notes where tweet_id = p_tweet_id and submitted_at is not null) then
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

create function public.cancel_signal_submission(p_tweet_id text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_tweet_id is null or p_tweet_id !~ '^[0-9]+$' then
    raise exception 'A numeric tweet ID is required';
  end if;
  perform pg_advisory_xact_lock(792634018153::bigint);
  delete from public.signal_submission_queue where tweet_id = p_tweet_id;
end;
$$;

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
    where not exists (select 1 from public.notes n where
      (c.note_id is not null and n.note_id = c.note_id and
        n.submitted_at > v_now - interval '24 hours') or
      (c.note_id is null and n.tweet_id = c.tweet_id and n.submitted_at is not null))
  ), occupied as (
    select false as pending, submitted_at + interval '24 hours' as expires_at
      from public.notes where submitted_at > v_now - interval '24 hours'
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
  if exists (select 1 from public.notes where tweet_id = p_tweet_id and submitted_at is not null) then
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

create or replace function public.finish_note_submission_claim(
  p_claim_id uuid, p_status text, p_note_id text default null, p_reason text default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_claim public.note_submission_claims%rowtype;
  v_now timestamptz;
  v_used bigint;
  v_daily_limit boolean := p_status = 'rejected' and lower(coalesce(p_reason, '')) like '%daily limit%';
begin
  if p_status is null or p_status not in ('submitted', 'rejected', 'uncertain') then
    raise exception 'Unknown submission outcome';
  end if;
  if p_status = 'submitted' and (p_note_id is null or p_note_id = '') then
    raise exception 'A submitted note requires its X note ID';
  end if;
  perform pg_advisory_xact_lock(792634018153::bigint);
  v_now := clock_timestamp();
  select * into v_claim from public.note_submission_claims where id = p_claim_id for update;
  if not found then raise exception 'Submission claim not found'; end if;
  if v_claim.status = p_status and v_claim.note_id is not distinct from p_note_id then return; end if;
  if v_claim.status not in ('claimed', 'uncertain') then
    raise exception 'Submission claim is already settled';
  end if;
  update public.note_submission_claims set status = p_status, note_id = p_note_id,
    reason = left(p_reason, 500), resolved_at = v_now where id = p_claim_id;
  if v_daily_limit then
    v_used := (public.get_note_submission_capacity() ->> 'used24h')::bigint;
    insert into public.pipeline_state (key, value) values
      ('limit_hit_at', v_now::text), ('limit_hit_value', v_used::text), ('writing_limit', v_used::text)
      on conflict (key) do update set value = excluded.value;
  elsif p_status <> 'rejected' or p_reason is distinct from 'signal_submission_deferred' then
    delete from public.signal_submission_queue where tweet_id = v_claim.tweet_id;
  end if;
end;
$$;

revoke all on function public.queue_signal_submission(text) from public, anon, authenticated;
revoke all on function public.cancel_signal_submission(text) from public, anon, authenticated;
grant execute on function public.queue_signal_submission(text) to service_role;
grant execute on function public.cancel_signal_submission(text) to service_role;
