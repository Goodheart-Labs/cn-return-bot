-- The notewriter API: a key for each outside notewriter.
--
-- Until now a notewriter called the protocol of migration 168 with a Supabase
-- secret key. That key reads and writes every table, so it could only go to
-- the team's own notewriters. This migration gives a notewriter run by
-- someone outside the team a key of its own, and a second set of functions,
-- notewriter_api_*, that the public key of the website may call. Each of them
-- first finds the notewriter by the key in the X-Notewriter-Key header, so a
-- notewriter can only ever act as itself. The guide is docs/notewriter-api.md.
--
-- What an outside notewriter gets on top of the protocol:
--   - a cap on notes per 24 hours (notes_per_day),
--   - checks on every note before it is stored (the passage is in the post,
--     lengths, sources with web addresses),
--   - review_first: its notes wait for an admin before readers see them,
--   - a switch (disabled_at) that turns it off at once.
-- It never takes reader requests, and takes a feed post at most every 30
-- minutes.
--
-- This migration only adds. To undo it: drop the notewriter_api_* and
-- notewriter_admin_* functions, the four everything_notewriter_* helpers this
-- file creates (from_key, new_key, post_submission, own_assignment), the
-- two tables and the six columns.

alter table everything_notewriters
  add column outside boolean not null default false,
  add column contact text,
  add column notes_per_day int not null default 20 check (notes_per_day > 0),
  add column review_first boolean not null default true,
  add column disabled_at timestamptz,
  add column disabled_reason text;
comment on column everything_notewriters.outside is
  'True for a notewriter someone outside the team runs through the notewriter API (migration 182).';
comment on column everything_notewriters.notes_per_day is
  'How many notes the notewriter may send through the API in any 24 hours.';
comment on column everything_notewriters.review_first is
  'Notes sent through the API wait in everything_notewriter_submissions until an admin decides. False posts them at once.';
comment on column everything_notewriters.disabled_at is
  'Set when an admin switched the notewriter off. Its key is refused while this is set.';

create table everything_notewriter_keys (
  key_hash text primary key,
  notewriter_id text not null references everything_notewriters (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
comment on table everything_notewriter_keys is
  'API keys of notewriters (migration 182). Only the SHA-256 of a key is stored, so a key is shown once, when it is made.';

create table everything_notewriter_submissions (
  id uuid primary key default gen_random_uuid(),
  notewriter_id text not null references everything_notewriters (id),
  item_id uuid not null references everything_items (id) on delete cascade,
  payload jsonb not null,
  status text not null default 'waiting' check (status in ('waiting', 'posted', 'not_posted', 'rejected')),
  reason text,
  note_id uuid references everything_notes (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);
comment on table everything_notewriter_submissions is
  'Every note a notewriter sent through the API (migration 182), with what became of it. payload is the note as notewriter_add_note takes it.';
create index everything_notewriter_submissions_by_notewriter on everything_notewriter_submissions (notewriter_id, created_at desc);
create index everything_notewriter_submissions_waiting on everything_notewriter_submissions (created_at) where status = 'waiting';

alter table everything_notewriter_keys enable row level security;
alter table everything_notewriter_submissions enable row level security;
revoke all on everything_notewriter_keys, everything_notewriter_submissions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- The notewriter whose key is in the X-Notewriter-Key header. PostgREST turns
-- the SQLSTATE PT401 into the HTTP status 401, and so on for the others.
create function everything_notewriter_from_key() returns everything_notewriters
language plpgsql set search_path = public as $$
declare
  v_key text := nullif(btrim(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-notewriter-key', '')), '');
  v_id text;
  w everything_notewriters;
begin
  if v_key is null then
    raise exception 'Send your notewriter key in the X-Notewriter-Key header' using errcode = 'PT401';
  end if;
  update everything_notewriter_keys set last_used_at = now()
   where key_hash = encode(sha256(convert_to(v_key, 'UTF8')), 'hex') and revoked_at is null
  returning notewriter_id into v_id;
  if not found then
    raise exception 'This notewriter key is not valid' using errcode = 'PT401';
  end if;
  select * into w from everything_notewriters where id = v_id;
  if w.disabled_at is not null then
    raise exception 'The notewriter % is switched off: %', w.id, coalesce(w.disabled_reason, 'no reason given') using errcode = 'PT403';
  end if;
  return w;
end;
$$;

-- Makes a new key for a notewriter and returns it. This is the only moment
-- the key itself exists in the database.
create function everything_notewriter_new_key(p_notewriter text) returns text
language plpgsql set search_path = public as $$
declare
  v_key text := 'cnw_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into everything_notewriter_keys (key_hash, notewriter_id)
  values (encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), p_notewriter);
  return v_key;
end;
$$;

-- Posts a waiting submission as a note through the protocol and records what
-- became of it.
create function everything_notewriter_post_submission(p_submission uuid, p_actor text) returns jsonb
language plpgsql set search_path = public as $$
declare
  s everything_notewriter_submissions;
  v_answer jsonb;
begin
  select * into s from everything_notewriter_submissions where id = p_submission for update;
  if not found then raise exception 'There is no submission %', p_submission; end if;
  if s.status <> 'waiting' then raise exception 'Submission % is already %', p_submission, s.status; end if;
  v_answer := notewriter_add_note(s.notewriter_id, s.item_id, s.payload);
  update everything_notewriter_submissions
     set status = case when v_answer ->> 'kind' = 'posted' then 'posted' else 'not_posted' end,
         reason = v_answer ->> 'reason',
         note_id = (v_answer ->> 'note')::uuid,
         decided_at = now(), decided_by = p_actor
   where id = p_submission;
  return jsonb_build_object('submission', p_submission) || v_answer;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The API, callable with the website's public key plus a notewriter key
-- ---------------------------------------------------------------------------

-- The notewriter's settings, how many notes it has left today, the posts it
-- holds and its last failures.
create function notewriter_api_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
  v_sent int;
begin
  select count(*) into v_sent from everything_notewriter_submissions
   where notewriter_id = w.id and created_at > now() - interval '24 hours';
  return notewriter_status(w.id) - 'notewriter' || jsonb_build_object(
    'notewriter', jsonb_build_object(
      'id', w.id, 'name', w.name, 'every_minutes', w.every_minutes, 'lease_minutes', w.lease_minutes,
      'cooldown_until', w.cooldown_until, 'review_first', w.review_first, 'notes_per_day', w.notes_per_day),
    'notes_sent_last_24_hours', v_sent,
    'notes_left', greatest(w.notes_per_day - v_sent, 0));
end;
$$;

-- A post Common Notes has read, by its address, with the text a passage must
-- be copied from.
create function notewriter_api_post(p_url text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
  i everything_items;
begin
  select * into i from everything_items where url = btrim(p_url) and full_text is not null order by created_at desc limit 1;
  if not found then
    raise exception 'Common Notes has not read %. Only posts it has read can get a note through the API.', p_url using errcode = 'PT404';
  end if;
  return jsonb_build_object(
    'id', i.id, 'url', i.url, 'title', i.title, 'source', i.source,
    'creator', (select p.name from everything_projects p where p.id = i.project_id),
    'published_at', i.published_at, 'text', i.full_text, 'caption_cues', i.caption_cues);
end;
$$;

-- Sets how often the notewriter wants a feed post from the queue: null for
-- none, otherwise at least every 30 minutes. A post the queue hands out goes
-- to no other notewriter, so an outside notewriter gets a slow share.
create function notewriter_api_subscribe(p_every_minutes int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
begin
  if p_every_minutes < 30 then
    raise exception 'A feed post at most every 30 minutes: every_minutes must be 30 or more, or null for none' using errcode = 'PT400';
  end if;
  return notewriter_subscribe(w.id, p_every_minutes, false);
end;
$$;

create function notewriter_api_next_post() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
begin
  return notewriter_next_post(w.id);
end;
$$;

-- The assignment, if it is the calling notewriter's own.
create function everything_notewriter_own_assignment(p_assignment uuid) returns uuid
language plpgsql set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
begin
  if not exists (select 1 from everything_assignments where id = p_assignment and notewriter_id = w.id) then
    raise exception 'Assignment % is not yours', p_assignment using errcode = 'PT403';
  end if;
  return p_assignment;
end;
$$;

create function notewriter_api_finish(p_assignment uuid, p_summary jsonb default null, p_skip_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return notewriter_finish(everything_notewriter_own_assignment(p_assignment), p_summary, p_skip_reason);
end;
$$;

create function notewriter_api_fail(p_assignment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return notewriter_fail(everything_notewriter_own_assignment(p_assignment), p_reason);
end;
$$;

-- Sends one note on a post, named by its id or its address. The note is
-- checked, stored as a submission, and then either posted at once or left
-- waiting for an admin (review_first). A refused note raises, stores nothing
-- and does not count towards notes_per_day.
create function notewriter_api_add_note(p_note jsonb, p_item uuid default null, p_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  max_passage constant int := 3000;
  max_note constant int := 1000;
  max_sources constant int := 8;
  max_source_field constant int := 1500;
  w everything_notewriters := everything_notewriter_from_key();
  v_passage text := btrim(coalesce(p_note ->> 'passage', ''));
  v_text text := btrim(coalesce(p_note ->> 'note', ''));
  v_sources jsonb := coalesce(p_note -> 'sources', '[]');
  v_start jsonb := coalesce(p_note -> 'start_seconds', 'null');
  v_end jsonb := coalesce(p_note -> 'end_seconds', 'null');
  i everything_items;
  v_sent int;
  v_submission uuid;
begin
  -- One call per notewriter at a time, so two calls cannot both take the last
  -- note of the day.
  perform 1 from everything_notewriters where id = w.id for update;
  if p_item is not null then
    select * into i from everything_items where id = p_item;
  else
    select * into i from everything_items where url = btrim(p_url) and full_text is not null order by created_at desc limit 1;
  end if;
  if not found or i.full_text is null then
    raise exception 'Common Notes has not read this post. Only posts it has read can get a note through the API.' using errcode = 'PT404';
  end if;

  select count(*) into v_sent from everything_notewriter_submissions
   where notewriter_id = w.id and created_at > now() - interval '24 hours';
  if v_sent >= w.notes_per_day then
    raise exception 'The notewriter % may send % notes in 24 hours and has sent them', w.id, w.notes_per_day using errcode = 'PT429';
  end if;

  if v_passage = '' or length(v_passage) > max_passage then
    raise exception 'A note needs the passage of the post it is about, at most % characters', max_passage using errcode = 'PT400';
  end if;
  if position(regexp_replace(lower(v_passage), '\s+', ' ', 'g') in regexp_replace(lower(i.full_text), '\s+', ' ', 'g')) = 0 then
    raise exception 'The passage is not in the post. Copy it exactly from the text the API gave you.' using errcode = 'PT400';
  end if;
  if v_text = '' or length(v_text) > max_note then
    raise exception 'A note needs its text, at most % characters', max_note using errcode = 'PT400';
  end if;
  if jsonb_typeof(v_sources) <> 'array' or jsonb_array_length(v_sources) not between 1 and max_sources
     or exists (select 1 from jsonb_array_elements(v_sources) s
                 where jsonb_typeof(s) <> 'object'
                    or coalesce(s ->> 'url', '') !~ '^https?://[^\s]+$'
                    or length(s ->> 'url') > max_source_field
                    or length(coalesce(s ->> 'quote', '')) > max_source_field
                    or length(coalesce(s ->> 'explanation', '')) > max_source_field) then
    raise exception 'A note needs 1 to % sources, each with a url that starts with http:// or https://, and no field over % characters', max_sources, max_source_field using errcode = 'PT400';
  end if;
  if jsonb_typeof(v_start) not in ('number', 'null') or jsonb_typeof(v_end) not in ('number', 'null') then
    raise exception 'start_seconds and end_seconds are numbers, or left out' using errcode = 'PT400';
  end if;
  if exists (select 1 from everything_notewriter_submissions s
              where s.notewriter_id = w.id and s.item_id = i.id and s.status in ('waiting', 'posted')
                and everything_passages_overlap(s.payload ->> 'passage', v_passage)) then
    raise exception 'You already sent a note on this passage' using errcode = 'PT409';
  end if;

  -- Only the fields named here reach the note, whatever else was sent.
  insert into everything_notewriter_submissions (notewriter_id, item_id, payload)
  values (w.id, i.id, jsonb_build_object(
    'passage', v_passage, 'note', v_text, 'start_seconds', v_start, 'end_seconds', v_end,
    'sources', (select jsonb_agg(jsonb_build_object('url', s ->> 'url', 'quote', s ->> 'quote', 'explanation', s ->> 'explanation') order by n)
                  from jsonb_array_elements(v_sources) with ordinality as t(s, n))))
  returning id into v_submission;
  if w.review_first then
    return jsonb_build_object('kind', 'waiting', 'submission', v_submission);
  end if;
  return everything_notewriter_post_submission(v_submission, 'api');
end;
$$;

-- The notes the notewriter sent, newest first, each with what became of it
-- and, once it is posted, its votes. posted with a null note means the note
-- was later deleted from the site.
create function notewriter_api_notes(p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.sent_at desc), '[]')
      from (select s.id as submission, s.status, s.reason, s.created_at as sent_at, s.decided_at,
                   i.url, s.payload ->> 'passage' as passage, s.payload ->> 'note' as note_text,
                   n.id as note, n.helpful_count as helpful, n.somewhat_helpful_count as somewhat_helpful,
                   n.not_helpful_count as not_helpful
              from everything_notewriter_submissions s
              join everything_items i on i.id = s.item_id
              left join everything_notes n on n.id = s.note_id
             where s.notewriter_id = w.id
             order by s.created_at desc
             limit least(greatest(coalesce(p_limit, 50), 1), 200)) r);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. For admins, with the secret key
-- ---------------------------------------------------------------------------

-- Adds an outside notewriter and returns its key. The key is not stored, so
-- pass it on now.
create function notewriter_admin_create(p_id text, p_name text, p_owner text, p_contact text,
                                        p_review_first boolean default true, p_notes_per_day int default 20) returns text
language plpgsql set search_path = public as $$
begin
  insert into everything_notewriters (id, name, owner, contact, outside, review_first, notes_per_day)
  values (p_id, p_name, p_owner, p_contact, true, p_review_first, p_notes_per_day);
  return everything_notewriter_new_key(p_id);
end;
$$;

-- Replaces a notewriter's keys with a new one, for a lost or leaked key.
create function notewriter_admin_new_key(p_notewriter text) returns text
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from everything_notewriters where id = p_notewriter) then
    raise exception 'There is no notewriter %', p_notewriter;
  end if;
  update everything_notewriter_keys set revoked_at = now() where notewriter_id = p_notewriter and revoked_at is null;
  return everything_notewriter_new_key(p_notewriter);
end;
$$;

-- Switches a notewriter off or on again. Off refuses its key at once and ends
-- its subscription. The notes it posted stay up.
create function notewriter_admin_switch(p_notewriter text, p_on boolean, p_reason text default null) returns void
language plpgsql set search_path = public as $$
begin
  update everything_notewriters
     set disabled_at = case when p_on then null else now() end,
         disabled_reason = case when p_on then null else p_reason end,
         every_minutes = case when p_on then every_minutes else null end
   where id = p_notewriter;
  if not found then raise exception 'There is no notewriter %', p_notewriter; end if;
end;
$$;

-- Decides a waiting submission: approve posts it as a note, otherwise it is
-- rejected with the reason, which the notewriter sees.
create function notewriter_admin_decide(p_submission uuid, p_approve boolean, p_actor text, p_reason text default null) returns jsonb
language plpgsql set search_path = public as $$
begin
  if p_approve then return everything_notewriter_post_submission(p_submission, p_actor); end if;
  update everything_notewriter_submissions
     set status = 'rejected', reason = p_reason, decided_at = now(), decided_by = p_actor
   where id = p_submission and status = 'waiting';
  if not found then raise exception 'There is no waiting submission %', p_submission; end if;
  return jsonb_build_object('submission', p_submission, 'kind', 'rejected');
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'everything_notewriter_from_key()',
    'everything_notewriter_new_key(text)',
    'everything_notewriter_post_submission(uuid, text)',
    'everything_notewriter_own_assignment(uuid)',
    'notewriter_admin_create(text, text, text, text, boolean, int)',
    'notewriter_admin_new_key(text)',
    'notewriter_admin_switch(text, boolean, text)',
    'notewriter_admin_decide(uuid, boolean, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'notewriter_api_me()',
    'notewriter_api_post(text)',
    'notewriter_api_subscribe(int)',
    'notewriter_api_next_post()',
    'notewriter_api_finish(uuid, jsonb, text)',
    'notewriter_api_fail(uuid, text)',
    'notewriter_api_add_note(jsonb, uuid, text)',
    'notewriter_api_notes(int)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end;
$$;
