-- The X tag bot (GOO-212). People tag @CommonNotesBot under a post, the bot
-- answers with a draft note, and an approval in the thread submits it.
--
-- A thread is one tag and everything below it. Every post in it, the people's
-- and the bot's, is one row in x_tag_posts, so the reply tree can be rebuilt
-- from parent_tweet_id. Only the service role reads or writes these tables.

create table public.x_tag_threads (
  id uuid primary key default gen_random_uuid(),
  -- The post a note would go on.
  target_tweet_id text not null check (target_tweet_id ~ '^[0-9]+$'),
  -- The post that tagged the bot.
  request_tweet_id text not null unique check (request_tweet_id ~ '^[0-9]+$'),
  requester_id text not null,
  requester_handle text not null,
  -- The rendered post the first research read, and its findings. Revisions
  -- read the same, so they see the same post, media and comments.
  post_context text,
  findings text,
  -- The pipeline_runs row of the first answer, with its full log and cost.
  pipeline_run_id uuid,
  created_at timestamptz not null default now()
);
create index x_tag_threads_target_idx on public.x_tag_threads (target_tweet_id, created_at desc);

create table public.x_tag_posts (
  tweet_id text primary key check (tweet_id ~ '^[0-9]+$'),
  thread_id uuid not null references public.x_tag_threads (id) on delete cascade,
  parent_tweet_id text,
  author_id text not null,
  author_handle text not null,
  role text not null check (role in ('human', 'bot')),
  -- A human post is the request, or one of the four kinds the classifier
  -- sorts replies into. A bot post is a draft, a no-note answer, the answer to
  -- feedback, or one of the fixed replies.
  kind text not null check (kind in (
    'request', 'approve', 'improve_and_approve', 'feedback', 'other',
    'draft', 'no_note', 'answer', 'queued', 'submitted', 'other_draft_submitted',
    'already_submitted', 'not_on_path', 'gave_up', 'refused', 'unreadable'
  )),
  text text not null,
  -- On a draft: the note body and its sources, exactly what an approval of
  -- this post submits.
  draft jsonb,
  created_at timestamptz not null default now(),
  check ((role = 'human') = (kind in ('request', 'approve', 'improve_and_approve', 'feedback', 'other'))),
  check ((kind = 'draft') = (draft is not null))
);
create index x_tag_posts_thread_idx on public.x_tag_posts (thread_id, created_at);
create index x_tag_posts_parent_idx on public.x_tag_posts (parent_tweet_id);

alter table public.x_tag_threads enable row level security;
alter table public.x_tag_posts enable row level security;
revoke all on public.x_tag_threads, public.x_tag_posts from public, anon, authenticated;
grant select, insert, update, delete on public.x_tag_threads, public.x_tag_posts to service_role;

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
