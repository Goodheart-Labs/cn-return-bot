-- The X tag bot (GOO-212). People tag @CommonNotesBot under a post, and the bot
-- researches it and submits a Community Note, or says why it can't yet.
--
-- One row per tag. The bot answers every tag once, under the tag, and a note
-- that has to wait gets one more reply under that answer when it is settled.
-- Only the service role reads or writes this table.

create table public.x_tag_requests (
  -- The post that tagged the bot. A tag the stream delivers twice is stored once.
  request_tweet_id text primary key check (request_tweet_id ~ '^[0-9]+$'),
  -- The post a note would go on.
  target_tweet_id text not null check (target_tweet_id ~ '^[0-9]+$'),
  requester_id text not null,
  requester_handle text not null,
  text text not null,
  -- 'researching' until the bot answers, then what the answer was. A
  -- 'waiting' note is retried until it becomes 'submitted', 'gave_up',
  -- 'already_submitted' or 'deleted'.
  status text not null default 'researching' check (status in (
    'researching', 'submitted', 'waiting', 'gave_up', 'no_note',
    'already_submitted', 'repeated', 'unreadable', 'deleted'
  )),
  -- The bot's reply under the tag.
  answer_tweet_id text check (answer_tweet_id ~ '^[0-9]+$'),
  -- The note body and its sources, exactly what goes in when it is submitted.
  draft jsonb,
  note_id text,
  -- The pipeline_runs row of the research, with its full log and cost.
  pipeline_run_id uuid,
  created_at timestamptz not null default now(),
  check (status not in ('waiting', 'submitted', 'gave_up') or draft is not null)
);
create index x_tag_requests_target_idx on public.x_tag_requests (target_tweet_id, created_at desc);
create index x_tag_requests_waiting_idx on public.x_tag_requests (created_at) where status = 'waiting';

alter table public.x_tag_requests enable row level security;
revoke all on public.x_tag_requests from public, anon, authenticated;
grant select, insert, update, delete on public.x_tag_requests to service_role;

-- The tag bot submits in its own lane. It shares the approved-notes queue with
-- the Signal bot, so both get priority over the automatic pipeline.
alter table public.note_submission_claims drop constraint note_submission_claims_lane_check;
alter table public.note_submission_claims
  add constraint note_submission_claims_lane_check check (lane in ('automatic', 'signal', 'x_tag'));

-- The same function as in migration 100, except that it accepts the x_tag lane.
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
  if p_lane is null or p_lane not in ('automatic', 'signal', 'x_tag') then
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
