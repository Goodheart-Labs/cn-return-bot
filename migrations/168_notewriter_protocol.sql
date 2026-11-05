-- The notewriter protocol (GOO-724). Several AI notewriters share the Common
-- Notes queue. Each one says how often it wants a feed post. The queue hands
-- every post to exactly one notewriter at a time, and a notewriter that fails
-- gets a break that doubles with every failure in a row, while its post goes
-- to the next notewriter.
--
-- The functions below are the whole protocol, and notewriters call them over
-- Supabase's REST layer (POST /rest/v1/rpc/<function>). Each call is one
-- transaction, so a hand-out, or a failure with its break, happens completely
-- or not at all. Notewriters are trusted and call with a secret key. The anon
-- key of the website and the extension cannot call these functions.
--
-- This migration only adds. The writer switch everything_claude_settings and
-- the two Claude-only columns of everything_feed_schedule are dropped by
-- migration 169, once the new code runs everywhere.

-- ---------------------------------------------------------------------------
-- 1. Notewriters and assignments
-- ---------------------------------------------------------------------------

create table everything_notewriters (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  owner text not null,
  every_minutes int check (every_minutes > 0),
  takes_reader_requests boolean not null default false,
  lease_minutes int not null default 60 check (lease_minutes > 0),
  failures_in_a_row int not null default 0,
  cooldown_until timestamptz,
  last_seen_at timestamptz,
  silence_warned_for timestamptz,
  created_at timestamptz not null default now()
);
comment on table everything_notewriters is
  'One row per AI notewriter of Common Notes (GOO-724). every_minutes is its subscription to feed posts, null for none.';
comment on column everything_notewriters.lease_minutes is
  'How long the notewriter may hold a post. A post held longer is taken back, and that counts as a failure.';
comment on column everything_notewriters.last_seen_at is
  'The last call to notewriter_next_post or notewriter_subscribe. The feed run goes red when a notewriter with something to take is silent for 30 minutes.';
comment on column everything_notewriters.silence_warned_for is
  'The last_seen_at of the silence that Slack was last told about, or null while the notewriter is not silent.';

create table everything_assignments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references everything_items (id) on delete cascade,
  notewriter_id text not null references everything_notewriters (id),
  reader_request boolean not null,
  started_at timestamptz not null default now(),
  deadline timestamptz not null,
  ended_at timestamptz,
  outcome text check (outcome in ('done', 'skipped', 'failed', 'expired')),
  reason text,
  summary jsonb,
  check ((ended_at is null) = (outcome is null))
);
comment on table everything_assignments is
  'One row each time a post is handed to a notewriter (GOO-724). It is open while ended_at is null.';
create unique index everything_assignments_one_open_per_item on everything_assignments (item_id) where ended_at is null;
create index everything_assignments_by_notewriter on everything_assignments (notewriter_id, started_at desc);
create index everything_assignments_failures on everything_assignments (ended_at) where outcome in ('failed', 'expired');

alter table everything_notewriters enable row level security;
alter table everything_assignments enable row level security;
revoke all on everything_notewriters, everything_assignments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. New columns
-- ---------------------------------------------------------------------------

alter table everything_notes add column notewriter_id text references everything_notewriters (id);
comment on column everything_notes.notewriter_id is 'The AI notewriter that wrote the note. Null for a person''s note.';

alter table everything_items add column queued_at timestamptz;
comment on column everything_items.queued_at is
  'When the item last entered the queue. A notewriter that failed on it since then does not get it again.';
alter table everything_items add column caption_cues jsonb;
comment on column everything_items.caption_cues is
  'A video''s caption timings, [{start, end, text}], stored by the intake service before any notewriter gets the video.';

alter table everything_feed_schedule add column failures_reported_through timestamptz not null default now();
comment on column everything_feed_schedule.failures_reported_through is
  'The ended_at of the newest failed or expired assignment that a feed run has reported. Later ones turn the next run red.';

alter table everything_feed_schedule drop constraint everything_feed_schedule_next_run_reason_check;
alter table everything_feed_schedule add constraint everything_feed_schedule_next_run_reason_check
  check (next_run_reason in ('interval', 'midnight', 'idle', 'usage', 'handout'));

create function everything_items_stamp_queued_at() returns trigger language plpgsql as $$
begin
  if new.status = 'queued' and (tg_op = 'INSERT' or old.status is distinct from 'queued') then
    new.queued_at := now();
  end if;
  return new;
end;
$$;
create trigger everything_items_queued_at before insert or update of status on everything_items
  for each row execute function everything_items_stamp_queued_at();
update everything_items set queued_at = now() where status = 'queued';

-- ---------------------------------------------------------------------------
-- 3. The first notewriters
-- ---------------------------------------------------------------------------

insert into everything_notewriters (id, name, owner, every_minutes, takes_reader_requests, lease_minutes, last_seen_at) values
  ('claude-ai-box', 'Claude note writer', 'Jim and Nathan. Runs on Nathan''s ai-box, and on the devbox while the ai-box is down.', null, true, 180, now()),
  ('pipeline', 'GPT pipeline', 'Jim. Runs in the feed run and the intake service.', null, false, 60, null);

-- Every AI note so far was written by one of the two. The feed trigger
-- recomputes a note's feed fields on every update, and this update changes
-- none of their inputs, so it runs without the trigger.
alter table everything_notes disable trigger everything_notes_feed_fields;
update everything_notes n set notewriter_id = 'claude-ai-box'
  from everything_claude_drafts d
 where d.note_id = n.id and d.posted_as = 'ai';
update everything_notes set notewriter_id = 'pipeline'
 where notewriter_id is null and author_id is null and claim_id is not null;
alter table everything_notes enable trigger everything_notes_feed_fields;

-- The posts Claude holds right now, by its take events. The new runner adopts
-- them, so none is handed out a second time.
insert into everything_assignments (item_id, notewriter_id, reader_request, started_at, deadline)
select i.id, 'claude-ai-box', i.priority >= 2, e.at, e.at + interval '180 minutes'
  from everything_items i
  join lateral (select type, at from everything_claude_events
                 where item_id = i.id and type in ('item_taken', 'item_failed', 'item_finished')
                 order by id desc limit 1) e on true
 where i.status = 'queued' and e.type = 'item_taken';

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------

-- The SQL twin of passagesOverlap in src/everything/passageRequests.ts. Two
-- passages count as the same place when one contains the other, or when they
-- share 40 characters in a row. The verify file lists cases that the
-- TypeScript test checks too, so the two cannot drift apart.
create function everything_passages_overlap(a text, b text) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  shared constant int := 40;
  x text := btrim(regexp_replace(lower(coalesce(a, '')), '\s+', ' ', 'g'));
  y text := btrim(regexp_replace(lower(coalesce(b, '')), '\s+', ' ', 'g'));
  shorter text;
  longer text;
  i int := 0;
begin
  if x = '' or y = '' then return false; end if;
  if position(y in x) > 0 or position(x in y) > 0 then return true; end if;
  if length(x) <= length(y) then shorter := x; longer := y; else shorter := y; longer := x; end if;
  while i + shared <= length(shorter) loop
    if position(substr(shorter, i + 1, shared) in longer) > 0 then return true; end if;
    i := i + shared / 2;
  end loop;
  return false;
end;
$$;

-- A notewriter gets only posts whose text is stored, and a video only with its
-- caption timings. The intake service prepares every other queued post.
create function everything_item_is_prepared(i everything_items) returns boolean
language sql immutable set search_path = public as $$
  select i.full_text is not null and (i.source <> 'youtube' or i.caption_cues is not null)
$$;

-- Reader requests sit at the top tier of the queue (QUEUE_PRIORITY in
-- src/everything/db.ts).
create function everything_is_reader_request(i everything_items) returns boolean
language sql immutable set search_path = public as $$
  select i.priority >= 2
$$;

-- Whether the notewriter failed on the item since the item last entered the
-- queue.
create function everything_notewriter_failed_on(p_notewriter text, i everything_items) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from everything_assignments a
                  where a.item_id = i.id and a.notewriter_id = p_notewriter
                    and a.outcome in ('failed', 'expired')
                    and a.ended_at >= coalesce(i.queued_at, '-infinity'))
$$;

-- Whether some notewriter could still take the item: one that takes its kind
-- of post and has not failed on it in this stay in the queue.
create function everything_item_has_notewriter_left(i everything_items) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from everything_notewriters w
                  where (case when everything_is_reader_request(i) then w.takes_reader_requests else w.every_minutes is not null end)
                    and not everything_notewriter_failed_on(w.id, i))
$$;

-- The break after a failure: 15 minutes, doubled for every failure in a row,
-- at most 4 hours.
create function everything_notewriter_cooldown(p_failures_in_a_row int) returns interval
language sql immutable set search_path = public as $$
  select least(interval '15 minutes' * power(2, greatest(p_failures_in_a_row, 1) - 1), interval '4 hours')
$$;

-- Ends an assignment as failed or expired. The notewriter gets its break. The
-- post stays in the queue for the next notewriter, or, when no notewriter is
-- left that has not failed on it, it is marked failed like a failed pipeline
-- item, and the walk's retry rules take over.
create function everything_notewriter_record_failure(p_assignment uuid, p_outcome text, p_reason text) returns jsonb
language plpgsql set search_path = public as $$
declare
  a everything_assignments;
  w everything_notewriters;
  i everything_items;
  v_post text := 'back_in_queue';
begin
  update everything_assignments set ended_at = now(), outcome = p_outcome, reason = p_reason
   where id = p_assignment and ended_at is null
  returning * into a;
  if not found then raise exception 'Assignment % is not open', p_assignment; end if;
  update everything_notewriters
     set failures_in_a_row = failures_in_a_row + 1,
         cooldown_until = now() + everything_notewriter_cooldown(failures_in_a_row + 1)
   where id = a.notewriter_id
  returning * into w;
  select * into i from everything_items where id = a.item_id for update;
  if i.status = 'queued' and not everything_item_has_notewriter_left(i) then
    update everything_items
       set status = 'error', error = 'Every notewriter failed on it. The last failure: ' || p_reason,
           progress = null, processed_at = now()
     where id = i.id;
    v_post := 'failed';
  end if;
  return jsonb_build_object('cooldown_until', w.cooldown_until, 'post', v_post);
end;
$$;

-- Takes back every post whose deadline has passed, as a failure of its
-- holder. notewriter_next_post calls it, and so does the feed run, so a post
-- comes back even while nobody asks.
create function notewriter_take_back_overdue() returns int
language plpgsql set search_path = public as $$
declare
  v_id uuid;
  n int := 0;
begin
  for v_id in select id from everything_assignments
               where ended_at is null and deadline < now()
               for update skip locked loop
    perform everything_notewriter_record_failure(v_id, 'expired', 'The deadline passed without an answer');
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Hands one item to a notewriter.
create function everything_notewriter_assign(w everything_notewriters, i everything_items) returns jsonb
language plpgsql set search_path = public as $$
declare
  a everything_assignments;
  v_requests jsonb;
begin
  insert into everything_assignments (item_id, notewriter_id, reader_request, deadline)
  values (i.id, w.id, everything_is_reader_request(i), now() + make_interval(mins => w.lease_minutes))
  returning * into a;
  -- A feed post handed out leaves the queue one post short, so a feed run is
  -- started at once to walk for the next one.
  if not a.reader_request then
    update everything_feed_schedule set next_run_at = now(), next_run_reason = 'handout'
     where id and (next_run_at is null or next_run_at > now());
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('request', r.id, 'passage', r.selection, 'reason', r.steer) order by r.created_at), '[]')
    into v_requests
    from everything_note_requests r
   where r.item_id = i.id and r.status = 'enqueued' and r.status_reason = 'checking the selected passage' and r.selection is not null;
  return jsonb_build_object(
    'kind', 'post',
    'assignment', a.id,
    'deadline', a.deadline,
    'reader_request', a.reader_request,
    'item', jsonb_build_object(
      'id', i.id, 'url', i.url, 'title', i.title, 'source', i.source,
      'creator', (select p.name from everything_projects p where p.id = i.project_id),
      'published_at', i.published_at, 'text', i.full_text, 'caption_cues', i.caption_cues),
    'asked_passages', v_requests,
    'only_asked_passages', jsonb_array_length(v_requests) > 0 and i.checked_scope = 'page' and i.first_checked_at is not null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The protocol
-- ---------------------------------------------------------------------------

-- Called whenever a notewriter has room for one more post. Answers with a
-- post, or with when to ask again.
create function notewriter_next_post(p_notewriter text) returns jsonb
language plpgsql set search_path = public as $$
declare
  w everything_notewriters;
  i everything_items;
  v_due timestamptz;
begin
  update everything_notewriters set last_seen_at = now() where id = p_notewriter returning * into w;
  if not found then raise exception 'There is no notewriter %', p_notewriter; end if;
  perform notewriter_take_back_overdue();
  select * into w from everything_notewriters where id = p_notewriter;
  if w.cooldown_until > now() then
    return jsonb_build_object('kind', 'cooldown', 'until', w.cooldown_until);
  end if;
  if w.takes_reader_requests then
    select * into i from everything_items it
     where it.status = 'queued' and everything_is_reader_request(it) and everything_item_is_prepared(it)
       and not exists (select 1 from everything_assignments a where a.item_id = it.id and a.ended_at is null)
       and not everything_notewriter_failed_on(w.id, it)
     order by it.priority desc, it.published_at desc nulls first, it.created_at
     limit 1
       for update skip locked;
    if found then return everything_notewriter_assign(w, i); end if;
  end if;
  if w.every_minutes is null then
    return jsonb_build_object('kind', 'wait', 'until', null, 'reason', 'unsubscribed');
  end if;
  select max(a.started_at) + make_interval(mins => w.every_minutes) into v_due
    from everything_assignments a where a.notewriter_id = w.id and not a.reader_request;
  if v_due > now() then
    return jsonb_build_object('kind', 'wait', 'until', v_due, 'reason', 'not_due');
  end if;
  select * into i from everything_items it
   where it.status = 'queued' and not everything_is_reader_request(it) and everything_item_is_prepared(it)
     and not exists (select 1 from everything_assignments a where a.item_id = it.id and a.ended_at is null)
     and not everything_notewriter_failed_on(w.id, it)
   order by it.priority desc, it.published_at desc nulls first, it.created_at
   limit 1
     for update skip locked;
  if found then return everything_notewriter_assign(w, i); end if;
  return jsonb_build_object('kind', 'wait', 'until', null, 'reason', 'queue_empty');
end;
$$;

-- Posts one note on an item as an AI note of the notewriter. It needs no
-- assignment: a notewriter may add notes to any post at any time. A note on a
-- passage where a person already wrote one is not posted.
create function notewriter_add_note(p_notewriter text, p_item uuid, p_note jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_passage text := btrim(coalesce(p_note ->> 'passage', ''));
  v_text text := btrim(coalesce(p_note ->> 'note', ''));
  v_sources jsonb := coalesce(p_note -> 'sources', '[]');
  v_item everything_items;
  v_person record;
  v_claim uuid;
  v_note uuid;
begin
  if not exists (select 1 from everything_notewriters where id = p_notewriter) then
    raise exception 'There is no notewriter %', p_notewriter;
  end if;
  select * into v_item from everything_items where id = p_item;
  if not found then raise exception 'There is no item %', p_item; end if;
  if v_passage = '' then raise exception 'A note needs the passage of the post it is about'; end if;
  if v_text = '' then raise exception 'A note needs its text'; end if;
  if jsonb_typeof(v_sources) <> 'array' or jsonb_array_length(v_sources) = 0
     or exists (select 1 from jsonb_array_elements(v_sources) s where btrim(coalesce(s ->> 'url', '')) = '') then
    raise exception 'A note needs at least one source, and every source needs its url';
  end if;
  select n.author_name into v_person
    from everything_claims c join everything_notes n on n.claim_id = c.id
   where c.item_id = p_item and n.author_id is not null
     and everything_passages_overlap(coalesce(c.context_quote, c.claim), v_passage)
   limit 1;
  if found then
    return jsonb_build_object('kind', 'not_posted',
      'reason', coalesce(v_person.author_name, 'A person') || ' already wrote a note on this passage');
  end if;
  insert into everything_claims (item_id, claim, judgement, context_quote, context_url, start_seconds, end_seconds, status)
  values (p_item, left(v_passage, 300), 'notewriter', v_passage,
          coalesce(p_note ->> 'context_url', v_item.url),
          (p_note ->> 'start_seconds')::numeric::int, (p_note ->> 'end_seconds')::numeric::int, 'note')
  returning id into v_claim;
  insert into everything_notes (claim_id, note, notewriter_id)
  values (v_claim, v_text, p_notewriter)
  returning id into v_note;
  insert into everything_note_sources (note_id, url, quote, explanation, sort_order)
  select v_note, s ->> 'url', s ->> 'quote', s ->> 'explanation', (n - 1)::int
    from jsonb_array_elements(v_sources) with ordinality as t(s, n);
  return jsonb_build_object('kind', 'posted', 'note', v_note, 'claim', v_claim);
end;
$$;

-- Ends an assignment because the notewriter is done with the post, with or
-- without notes, or because the post is not worth checking (p_skip_reason).
-- Each passage a reader asked about before the post was handed out gets its
-- answer. A request that came in while the notewriter worked puts the post
-- back in the queue.
create function notewriter_finish(p_assignment uuid, p_summary jsonb default null, p_skip_reason text default null) returns jsonb
language plpgsql set search_path = public as $$
declare
  a everything_assignments;
  v_post text := 'done';
begin
  select * into a from everything_assignments where id = p_assignment for update;
  if not found then raise exception 'There is no assignment %', p_assignment; end if;
  if a.ended_at is not null then raise exception 'Assignment % already ended as %', p_assignment, a.outcome; end if;
  if a.deadline < now() then
    raise exception 'The deadline of assignment % passed at %, so the post was taken back. Notes posted before stay up.', p_assignment, a.deadline;
  end if;
  update everything_note_requests r
     set status = 'done',
         status_reason = case when exists (
           select 1 from everything_claims c join everything_notes n on n.claim_id = c.id
            where c.item_id = a.item_id and n.created_at >= a.started_at
              and everything_passages_overlap(coalesce(c.context_quote, c.claim), r.selection))
           then 'the selected passage got a note' else 'the selected passage needs no note' end
   where r.item_id = a.item_id and r.status = 'enqueued' and r.status_reason = 'checking the selected passage'
     and r.selection is not null and r.created_at <= a.started_at;
  update everything_items
     set status = 'done', error = null, progress = null, skip_reason = p_skip_reason, processed_at = now()
   where id = a.item_id;
  if exists (select 1 from everything_note_requests r
              where r.item_id = a.item_id and r.status = 'enqueued' and r.status_reason = 'checking the selected passage'
                and r.selection is not null) then
    update everything_items set status = 'queued' where id = a.item_id;
    v_post := 'back_in_queue';
  end if;
  update everything_assignments
     set ended_at = now(), outcome = case when p_skip_reason is null then 'done' else 'skipped' end,
         reason = p_skip_reason, summary = p_summary
   where id = p_assignment;
  update everything_notewriters set failures_in_a_row = 0, cooldown_until = null where id = a.notewriter_id;
  return jsonb_build_object('post', v_post);
end;
$$;

-- Ends an assignment because the notewriter could not finish the post.
create function notewriter_fail(p_assignment uuid, p_reason text) returns jsonb
language plpgsql set search_path = public as $$
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'A failure needs its reason'; end if;
  perform 1 from everything_assignments where id = p_assignment for update;
  if not found then raise exception 'There is no assignment %', p_assignment; end if;
  return everything_notewriter_record_failure(p_assignment, 'failed', p_reason);
end;
$$;

-- Sets how often the notewriter wants a feed post (null for none) and whether
-- it takes reader requests (null keeps the setting).
create function notewriter_subscribe(p_notewriter text, p_every_minutes int, p_takes_reader_requests boolean default null) returns jsonb
language plpgsql set search_path = public as $$
declare
  w everything_notewriters;
begin
  update everything_notewriters
     set every_minutes = p_every_minutes,
         takes_reader_requests = coalesce(p_takes_reader_requests, takes_reader_requests),
         last_seen_at = now()
   where id = p_notewriter
  returning * into w;
  if not found then raise exception 'There is no notewriter %', p_notewriter; end if;
  return jsonb_build_object('every_minutes', w.every_minutes, 'takes_reader_requests', w.takes_reader_requests);
end;
$$;

-- The notewriter's settings, its break, the posts it holds and its last
-- failures.
create function notewriter_status(p_notewriter text) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  w everything_notewriters;
begin
  select * into w from everything_notewriters where id = p_notewriter;
  if not found then raise exception 'There is no notewriter %', p_notewriter; end if;
  return jsonb_build_object(
    'notewriter', to_jsonb(w) - 'silence_warned_for',
    'open', (select coalesce(jsonb_agg(jsonb_build_object(
                'assignment', a.id, 'started_at', a.started_at, 'deadline', a.deadline, 'reader_request', a.reader_request,
                'item', jsonb_build_object('id', i.id, 'url', i.url, 'title', i.title)) order by a.started_at), '[]')
               from everything_assignments a join everything_items i on i.id = a.item_id
              where a.notewriter_id = w.id and a.ended_at is null),
    'last_failures', (select coalesce(jsonb_agg(f order by f.ended_at desc), '[]')
                        from (select a.ended_at, a.outcome, a.reason, i.url
                                from everything_assignments a join everything_items i on i.id = a.item_id
                               where a.notewriter_id = w.id and a.outcome in ('failed', 'expired')
                               order by a.ended_at desc limit 5) f));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. For the feed run and the admin dashboard
-- ---------------------------------------------------------------------------

-- How many feed posts the notewriters want waiting, one for each subscribed
-- notewriter that is not on a break, and how many wait now.
create function notewriter_feed_posts_wanted() returns table (wanted int, waiting int)
language sql stable set search_path = public as $$
  select (select count(*)::int from everything_notewriters
           where every_minutes is not null and (cooldown_until is null or cooldown_until <= now())),
         (select count(*)::int from everything_items i
           where i.status = 'queued' and not everything_is_reader_request(i)
             and not exists (select 1 from everything_assignments a where a.item_id = i.id and a.ended_at is null))
$$;

-- The dashboard's Notewriters section. Admins only.
create function everything_notewriters_overview()
returns table (id text, name text, owner text, every_minutes int, takes_reader_requests boolean, lease_minutes int,
               failures_in_a_row int, cooldown_until timestamptz, last_seen_at timestamptz, open_posts int,
               done_7d int, failed_7d int, last_failure text, last_failure_at timestamptz, notes_7d int, notes_total int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not everything_is_admin() then raise exception 'Only admins can see the notewriters'; end if;
  return query
  select w.id, w.name, w.owner, w.every_minutes, w.takes_reader_requests, w.lease_minutes,
         w.failures_in_a_row, w.cooldown_until, w.last_seen_at,
         (select count(*)::int from everything_assignments a where a.notewriter_id = w.id and a.ended_at is null),
         (select count(*)::int from everything_assignments a
           where a.notewriter_id = w.id and a.outcome in ('done', 'skipped') and a.ended_at > now() - interval '7 days'),
         (select count(*)::int from everything_assignments a
           where a.notewriter_id = w.id and a.outcome in ('failed', 'expired') and a.ended_at > now() - interval '7 days'),
         f.reason, f.ended_at,
         (select count(*)::int from everything_notes n where n.notewriter_id = w.id and n.created_at > now() - interval '7 days'),
         (select count(*)::int from everything_notes n where n.notewriter_id = w.id)
    from everything_notewriters w
    left join lateral (select a.reason, a.ended_at from everything_assignments a
                        where a.notewriter_id = w.id and a.outcome in ('failed', 'expired')
                        order by a.ended_at desc limit 1) f on true
   order by w.created_at;
end;
$$;

create index everything_notes_by_notewriter on everything_notes (notewriter_id, created_at) where notewriter_id is not null;

-- ---------------------------------------------------------------------------
-- 7. Claude's posting goes through notewriter_add_note
-- ---------------------------------------------------------------------------

-- An AI note of the Claude note writer is posted by notewriter_add_note, like
-- any notewriter's note. A note a reviewer posts as themselves keeps the old
-- path, because it is a person's note.
create or replace function everything_claude_publish(p_draft uuid, p_posted_as text, p_actor text, p_author uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  d everything_claude_drafts;
  v_item_url text;
  v_claim uuid;
  v_note uuid;
  v_posted jsonb;
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  if (p_posted_as = 'ai') <> (p_author is null) then
    raise exception 'An AI note has no author, and a person''s note needs one';
  end if;
  if p_posted_as = 'ai' then
    v_posted := notewriter_add_note('claude-ai-box', d.item_id, jsonb_build_object(
      'passage', d.passage, 'note', d.note, 'sources', d.sources,
      'context_url', d.video_timing ->> 'context_url',
      'start_seconds', d.video_timing -> 'start_seconds', 'end_seconds', d.video_timing -> 'end_seconds'));
    if v_posted ->> 'kind' <> 'posted' then raise exception 'Not posted: %', v_posted ->> 'reason'; end if;
    v_note := (v_posted ->> 'note')::uuid;
  else
    select url into v_item_url from everything_items where id = d.item_id;
    insert into everything_claims (item_id, claim, judgement, context_quote, context_url, start_seconds, end_seconds, status, created_by)
    values (
      d.item_id, left(d.passage, 300), 'claude_code', d.passage,
      coalesce(d.video_timing ->> 'context_url', v_item_url),
      (d.video_timing ->> 'start_seconds')::int, (d.video_timing ->> 'end_seconds')::int,
      'note', p_author
    )
    returning id into v_claim;
    -- The trigger everything_fill_author_name replaces this placeholder with
    -- the account's own name.
    insert into everything_notes (claim_id, note, author_id, author_name)
    values (v_claim, d.note, p_author, 'author')
    returning id into v_note;
    insert into everything_note_sources (note_id, url, quote, explanation, sort_order)
    select v_note, s ->> 'url', s ->> 'quote', s ->> 'explanation', (n - 1)::int
      from jsonb_array_elements(d.sources) with ordinality as t(s, n);
  end if;
  update everything_claude_drafts
     set status = 'posted', note_id = v_note, posted_as = p_posted_as, updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
  values (p_actor, 'posted', d.id, d.item_id, v_note, jsonb_build_object('posted_as', p_posted_as, 'note', d.note));
  return v_note;
end;
$$;

-- A notewriter's claim can be removed like a Claude claim.
create or replace function everything_claude_remove_note(p_note uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from everything_claims
   where judgement in ('claude_code', 'notewriter')
     and id = (select claim_id from everything_notes where id = p_note);
  if not found then
    raise exception 'Note % is not a live note of the Claude note writer', p_note;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Who may call what
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'everything_passages_overlap(text, text)',
    'everything_item_is_prepared(everything_items)',
    'everything_is_reader_request(everything_items)',
    'everything_notewriter_failed_on(text, everything_items)',
    'everything_item_has_notewriter_left(everything_items)',
    'everything_notewriter_cooldown(int)',
    'everything_notewriter_record_failure(uuid, text, text)',
    'notewriter_take_back_overdue()',
    'everything_notewriter_assign(everything_notewriters, everything_items)',
    'notewriter_next_post(text)',
    'notewriter_add_note(text, uuid, jsonb)',
    'notewriter_finish(uuid, jsonb, text)',
    'notewriter_fail(uuid, text)',
    'notewriter_subscribe(text, int, boolean)',
    'notewriter_status(text)',
    'notewriter_feed_posts_wanted()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

revoke all on function everything_notewriters_overview() from public, anon;
grant execute on function everything_notewriters_overview() to authenticated, service_role;

notify pgrst, 'reload schema';
