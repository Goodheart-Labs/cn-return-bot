-- Shared admission for every note-writing worker. Automatic submissions leave
-- three estimated slots for Signal; Signal may use those slots. The estimate
-- is not an X guarantee. Unknown capacity blocks automation, but allows Signal
-- to attempt a submission and establish an observed limit.
--
-- An API timeout is not proof that nothing was posted. Uncertain claims block
-- another submission to that tweet indefinitely, and consume capacity for 24h
-- after the uncertain response. An abandoned in-flight claim consumes capacity
-- until an operator reconciles it: it must never expire into an automatic retry.
-- Admission and settlement use the same transaction lock.

create table public.note_submission_claims (
  id uuid primary key default gen_random_uuid(),
  tweet_id text not null,
  lane text not null check (lane in ('automatic', 'signal')),
  status text not null default 'claimed'
    check (status in ('claimed', 'submitted', 'rejected', 'uncertain')),
  note_id text,
  reason text,
  claimed_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  check ((status = 'claimed') = (resolved_at is null)),
  check (status <> 'submitted' or note_id is not null)
);

create unique index note_submission_claims_active_tweet_idx
  on public.note_submission_claims (tweet_id) where status <> 'rejected';
create index note_submission_claims_resolved_at_idx
  on public.note_submission_claims (resolved_at);

alter table public.note_submission_claims enable row level security;
revoke all on public.note_submission_claims from public, anon, authenticated;
grant select, insert, update on public.note_submission_claims to service_role;

create function public.get_note_submission_capacity()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_used bigint;
  v_pending bigint;
  v_cap bigint;
  v_stored bigint;
  v_hit bigint;
  v_hit_at timestamptz;
  v_raw text;
begin
  -- A settled claim covers accepted notes whose notes-row write failed. Once
  -- that row exists it is counted only once. For a claim whose settlement write
  -- failed, matching our submitted tweet also prevents counting it twice.
  -- One SQL statement gives notes and claims the same snapshot even when an
  -- accepted note's logging write completes concurrently with this count.
  with unrecorded_claims as (
    select c.* from public.note_submission_claims c
      where not exists (select 1 from public.notes n where
        (c.note_id is not null and n.note_id = c.note_id and
          n.submitted_at > v_now - interval '24 hours') or
        -- Admission already ruled out existing submissions for this tweet.
        -- Do not compare database and worker timestamps: clock skew could
        -- otherwise count a logged acceptance and its unresolved claim twice.
        (c.note_id is null and n.tweet_id = c.tweet_id and n.submitted_at is not null))
  )
  select
    (select count(*) from public.notes where submitted_at > v_now - interval '24 hours') +
      count(*) filter (where status = 'submitted' and resolved_at > v_now - interval '24 hours'),
    count(*) filter (where status = 'claimed' or
      (status = 'uncertain' and resolved_at > v_now - interval '24 hours'))
    into v_used, v_pending from unrecorded_claims;

  select value into v_raw from public.pipeline_state where key = 'writing_limit';
  if v_raw ~ '^[0-9]{1,9}$' then v_stored := v_raw::bigint; end if;
  select value into v_raw from public.pipeline_state where key = 'limit_hit_value';
  if v_raw ~ '^[0-9]{1,9}$' then v_hit := v_raw::bigint; end if;
  select value into v_raw from public.pipeline_state where key = 'limit_hit_at';
  begin
    v_hit_at := v_raw::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    v_hit_at := null;
  end;

  if v_hit_at > v_now - interval '24 hours' and v_hit_at <= v_now
     and v_hit is not null and v_used <= v_hit then
    v_cap := v_hit;
  else
    v_cap := v_stored;
  end if;

  return jsonb_build_object('cap', v_cap, 'used24h', v_used,
    'inFlight', v_pending, 'remaining', case when v_cap is null then null
      else greatest(0, v_cap - v_used - v_pending) end, 'reserve', 3);
end;
$$;

create function public.claim_note_submission(p_tweet_id text, p_lane text default 'automatic')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_capacity jsonb;
  v_existing text;
  v_id uuid;
  v_remaining bigint;
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
    return jsonb_build_object('status', 'submission_busy', 'reason', v_existing,
      'capacity', v_capacity);
  end if;

  v_remaining := (v_capacity ->> 'remaining')::bigint;
  if p_lane = 'automatic' and v_remaining is null then
    return jsonb_build_object('status', 'capacity_reserved', 'reason', 'unknown_capacity',
      'capacity', v_capacity);
  elsif v_remaining is not null and v_remaining <= (case when p_lane = 'automatic' then 3 else 0 end) then
    return jsonb_build_object('status', 'capacity_reserved', 'reason',
      case when v_remaining = 0 then 'capacity_exhausted' else 'reserve' end,
      'capacity', v_capacity);
  end if;

  insert into public.note_submission_claims (tweet_id, lane) values (p_tweet_id, p_lane)
    returning id into v_id;
  return jsonb_build_object('status', 'claimed', 'claimId', v_id, 'capacity', v_capacity);
end;
$$;

create function public.finish_note_submission_claim(
  p_claim_id uuid, p_status text, p_note_id text default null, p_reason text default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_claim public.note_submission_claims%rowtype;
begin
  if p_status is null or p_status not in ('submitted', 'rejected', 'uncertain') then
    raise exception 'Unknown submission outcome';
  end if;
  if p_status = 'submitted' and (p_note_id is null or p_note_id = '') then
    raise exception 'A submitted note requires its X note ID';
  end if;
  perform pg_advisory_xact_lock(792634018153::bigint);
  select * into v_claim from public.note_submission_claims where id = p_claim_id for update;
  if not found then raise exception 'Submission claim not found'; end if;
  -- Settlement is idempotent, but cannot undo a confirmed result. A service-role
  -- operator may reconcile an uncertain claim after checking X's written notes.
  if v_claim.status = p_status and v_claim.note_id is not distinct from p_note_id then return; end if;
  if v_claim.status not in ('claimed', 'uncertain') then
    raise exception 'Submission claim is already settled';
  end if;
  update public.note_submission_claims
    set status = p_status, note_id = p_note_id, reason = left(p_reason, 500),
      resolved_at = clock_timestamp()
    where id = p_claim_id;
end;
$$;

revoke all on function public.get_note_submission_capacity() from public, anon, authenticated;
revoke all on function public.claim_note_submission(text, text) from public, anon, authenticated;
revoke all on function public.finish_note_submission_claim(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.get_note_submission_capacity() to service_role;
grant execute on function public.claim_note_submission(text, text) to service_role;
grant execute on function public.finish_note_submission_claim(uuid, text, text, text) to service_role;
