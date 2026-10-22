-- 130: the note review page on commonnotes.net, for admins only (GOO-518).
--
-- Until now Jim and Nathan reviewed the Claude note writer's notes in a local
-- dashboard that read the tables of migration 129 with the service key. The
-- review page now lives on the website. The tables stay closed to the anon and
-- authenticated roles, exactly as 129 left them. Every read and write of the
-- page goes through the functions below instead. Each one runs with its
-- owner's rights (SECURITY DEFINER) and first asks everything_is_admin(), so a
-- caller who is not an admin gets an error and no data.
--
-- The Claude session calls the same functions with the service key. So there
-- is one implementation of posting, rewriting and removing a note, whoever
-- does it. With the service key the caller names the actor ('jim', 'nathan' or
-- 'claude'). An admin is always recorded as themselves, whatever they pass.

-- 1. Which reviewer each admin is.
--
-- The drafts and the event log name reviewers as 'jim' and 'nathan', and
-- Claude's brief reads those names. Nathan signs in with two addresses, so the
-- name lives next to each address.

alter table everything_admins add column reviewer text check (reviewer in ('jim', 'nathan'));
update everything_admins set reviewer = 'jim' where email = 'jimmaar1@gmail.com';
update everything_admins set reviewer = 'nathan' where email in ('nathanpmyoung@gmail.com', 'nathan@goodheartlabs.com');

-- 2. What a draft needs so the page never reads a whole post.
--
-- context_paragraph is the post's paragraph around the passage, cut to a
-- window when the paragraph is a whole transcript. The Claude session stores
-- it when it saves a draft, and a one-off script fills the existing drafts.
-- video_timing is where the passage sits in a video, worked out from the
-- caption cues that only the devbox has. Storing it on the draft lets an
-- approval or a rewrite on the website post the note at the right moment of
-- the video. Drafts whose live note already has a time get it copied here.

alter table everything_claude_drafts
  add column context_paragraph text,
  add column video_timing jsonb check (video_timing is null or jsonb_typeof(video_timing) = 'object');

comment on column everything_claude_drafts.video_timing is
  '{ start_seconds, end_seconds, context_url }: where the passage sits in a video. Null for a post that is no video.';

update everything_claude_drafts d
   set video_timing = jsonb_build_object('start_seconds', c.start_seconds, 'end_seconds', c.end_seconds, 'context_url', c.context_url)
  from everything_notes n
  join everything_claims c on c.id = n.claim_id
 where d.note_id = n.id and c.start_seconds is not null;

-- The page shows one section at a time, newest first, one page at a time.
create index everything_claude_drafts_section on everything_claude_drafts (status, created_at desc, id desc);

-- 3. Who is acting.

-- An admin's reviewer name. A caller with the service key names the actor
-- itself. Everyone else gets an error, which is what keeps every function
-- below closed to them.
create function everything_claude_actor(p_actor text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_reviewer text;
begin
  if auth.role() = 'service_role' then
    if p_actor is null or p_actor not in ('jim', 'nathan', 'claude') then
      raise exception 'Name the actor: jim, nathan or claude';
    end if;
    return p_actor;
  end if;
  if everything_is_admin() then
    select a.reviewer into v_reviewer
      from auth.users u
      join everything_admins a on a.email = lower(u.email)
     where u.id = auth.uid();
  end if;
  if v_reviewer is null then
    raise exception 'Only an admin may do this' using errcode = '42501';
  end if;
  return v_reviewer;
end;
$$;

-- 4. Posting and removing a note.

-- Creates a claim on the draft's passage, posts the note on it with one
-- source row per supporting quote, and records the draft as posted. An AI note
-- has no author. A person's note names their account, and the database's own
-- triggers then fill in their display name and cast their Helpful vote.
create function everything_claude_publish(p_draft uuid, p_posted_as text, p_author uuid, p_actor text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  d everything_claude_drafts;
  v_item_url text;
  v_claim uuid;
  v_note uuid;
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  if (p_posted_as = 'ai') <> (p_author is null) then
    raise exception 'An AI note has no author, and a person''s note needs one';
  end if;
  select url into v_item_url from everything_items where id = d.item_id;
  -- A claim keeps only a preview of its passage in `claim`, as on the
  -- website. The full passage is the claim's context_quote.
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
  values (v_claim, d.note, p_author, case when p_author is null then null else 'author' end)
  returning id into v_note;
  insert into everything_note_sources (note_id, url, quote, explanation, sort_order)
  select v_note, s ->> 'url', s ->> 'quote', s ->> 'explanation', (n - 1)::int
    from jsonb_array_elements(d.sources) with ordinality as t(s, n);
  update everything_claude_drafts
     set status = 'posted', note_id = v_note, posted_as = p_posted_as, updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
  values (p_actor, 'posted', d.id, d.item_id, v_note, jsonb_build_object('posted_as', p_posted_as, 'note', d.note));
  return v_note;
end;
$$;

-- Deletes a note the Claude note writer posted, together with the claim it
-- created for it. Votes, sources and comments go with the note by cascade.
create function everything_claude_remove_note(p_note uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from everything_claims
   where judgement = 'claude_code'
     and id = (select claim_id from everything_notes where id = p_note);
  if not found then
    raise exception 'Note % is not a live note of the Claude note writer', p_note;
  end if;
end;
$$;

-- 5. What reviewers and Claude do.

-- A reviewer keeps a note. A note that waited for approval goes up now, as an
-- AI note. Returns the live note's id, so the page can cast the reviewer's
-- Helpful vote on it through the website's ordinary vote, which also records
-- the donation.
create function everything_claude_approve(p_draft uuid, p_actor text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  d everything_claude_drafts;
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found or d.outcome <> 'note' or d.status not in ('posted', 'awaiting_approval') then
    raise exception 'Only a posted note or one waiting for approval can be approved';
  end if;
  if d.status = 'awaiting_approval' then
    perform everything_claude_publish(d.id, 'ai', null, v_actor);
  end if;
  update everything_claude_drafts
     set reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
   where id = p_draft
  returning * into d;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id)
  values (v_actor, 'approved', d.id, d.item_id, d.note_id);
  return d.note_id;
end;
$$;

-- A reviewer turns a note down. A posted note is deleted from the site.
create function everything_claude_reject(p_draft uuid, p_reason text, p_actor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  d everything_claude_drafts;
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found or d.status not in ('posted', 'awaiting_approval') then
    raise exception 'Only a posted note or one waiting for approval can be rejected';
  end if;
  if d.note_id is not null then
    perform everything_claude_remove_note(d.note_id);
  end if;
  update everything_claude_drafts
     set status = 'rejected', note_id = null, reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
  values (v_actor, 'rejected', d.id, d.item_id, d.note_id, jsonb_build_object('reason', coalesce(p_reason, ''), 'note', d.note));
end;
$$;

-- Replaces a draft's note text. A posted note is replaced on the site: the new
-- text goes up and the old note is deleted with its votes.
--
-- p_posted_as says who the new note is posted as. 'ai' posts an AI note. 'me'
-- posts it under the signed-in admin's own account, so it is only for admins.
-- Null keeps whoever the old note was posted as, on the same account.
-- A new passage comes with its paragraph and video timing, which the Claude
-- session works out on the devbox. Returns the live note's id, or null when
-- the draft is not posted.
create function everything_claude_rewrite(
  p_draft uuid,
  p_note text,
  p_reason text,
  p_posted_as text default null,
  p_sources jsonb default null,
  p_passage text default null,
  p_context_paragraph text default null,
  p_video_timing jsonb default null,
  p_actor text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  d everything_claude_drafts;
  v_posted_as text;
  v_author uuid;
begin
  if p_posted_as is not null and p_posted_as not in ('ai', 'me') then
    raise exception 'Post as ai or me';
  end if;
  if p_posted_as = 'me' and auth.uid() is null then
    raise exception 'Only a signed-in admin can post a note as themselves';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'The note is empty';
  end if;
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  update everything_claude_drafts
     set note = p_note,
         outcome = 'note',
         sources = coalesce(p_sources, sources),
         passage = coalesce(p_passage, passage),
         context_paragraph = case when p_passage is null then context_paragraph else p_context_paragraph end,
         video_timing = case when p_passage is null then video_timing else p_video_timing end,
         updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, data)
  values (v_actor, 'rewritten', d.id, d.item_id, jsonb_build_object(
    'reason', coalesce(p_reason, ''), 'previous_note', d.note, 'previous_sources', d.sources,
    'previous_passage', d.passage, 'note', p_note
  ));
  if d.status <> 'posted' or d.note_id is null then
    return null;
  end if;
  if p_posted_as = 'ai' then
    v_posted_as := 'ai';
  elsif p_posted_as = 'me' then
    v_posted_as := v_actor;
    v_author := auth.uid();
  else
    v_posted_as := d.posted_as;
    select author_id into v_author from everything_notes where id = d.note_id;
  end if;
  perform everything_claude_remove_note(d.note_id);
  return everything_claude_publish(d.id, v_posted_as, v_author, v_actor);
end;
$$;

-- Claude takes back a note it no longer stands behind.
create function everything_claude_withdraw(p_draft uuid, p_reason text, p_actor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  d everything_claude_drafts;
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  if d.note_id is not null then
    perform everything_claude_remove_note(d.note_id);
  end if;
  update everything_claude_drafts
     set outcome = 'withdrawn', status = 'not_a_note', note_id = null, updated_at = now()
   where id = p_draft;
  insert into everything_claude_events (actor, type, draft_id, item_id, note_id, data)
  values (v_actor, 'withdrawn', d.id, d.item_id, d.note_id, jsonb_build_object('reason', coalesce(p_reason, ''), 'note', d.note));
end;
$$;

-- A chat message from a reviewer, or Claude's answer to one. The Claude
-- session's watcher picks up every message that has no answer after it.
create function everything_claude_message(p_draft uuid, p_text text, p_actor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
  v_item uuid;
begin
  if coalesce(trim(p_text), '') = '' then
    raise exception 'The message is empty';
  end if;
  select item_id into v_item from everything_claude_drafts where id = p_draft;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  insert into everything_claude_events (actor, type, draft_id, item_id, data)
  values (v_actor, case when v_actor = 'claude' then 'answer' else 'message' end, p_draft, v_item, jsonb_build_object('text', p_text));
end;
$$;

-- Changes who writes the notes, or whether notes wait for approval. A null
-- argument leaves that setting alone.
create function everything_claude_change_settings(p_writer text default null, p_approval_required boolean default null, p_actor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor text := everything_claude_actor(p_actor);
begin
  update everything_claude_settings
     set writer = coalesce(p_writer, writer),
         approval_required = coalesce(p_approval_required, approval_required),
         updated_at = now(),
         updated_by = v_actor
   where id;
  insert into everything_claude_events (actor, type, data)
  values (v_actor, 'settings_changed', jsonb_strip_nulls(jsonb_build_object('writer', p_writer, 'approvalRequired', p_approval_required)));
end;
$$;

-- 6. What the page reads.

-- The page's header: who is reviewing, the settings, and how many drafts each
-- section of the sidebar holds.
create function everything_claude_review_summary()
returns table (
  reviewer text, writer text, approval_required boolean,
  unreviewed bigint, waiting bigint, approved bigint, rejected bigint, no_note bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_reviewer text := everything_claude_actor(null);
begin
  return query
  select v_reviewer, s.writer, s.approval_required, c.*
    from everything_claude_settings s,
    lateral (
      select count(*) filter (where d.status = 'posted' and d.reviewed_by is null),
             count(*) filter (where d.status = 'awaiting_approval'),
             count(*) filter (where d.status = 'posted' and d.reviewed_by is not null),
             count(*) filter (where d.status = 'rejected'),
             count(*) filter (where d.status = 'not_a_note')
        from everything_claude_drafts d
    ) c;
end;
$$;

-- One draft as the page shows it: the draft, its post, its chat and the
-- earlier texts of its note.
create type everything_claude_review_draft as (
  id uuid,
  item_id uuid,
  passage text,
  claim text,
  kind text,
  outcome text,
  note text,
  reasoning text,
  sources jsonb,
  status text,
  note_id uuid,
  posted_as text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz,
  context_paragraph text,
  post_url text,
  post_title text,
  creator text,
  -- [{ at, actor, text }], oldest first.
  messages jsonb,
  -- [{ at, note, reason }], oldest first.
  earlier_versions jsonb
);

-- The drafts with these ids, newest first. The two functions below are the
-- only callers, and each checks the caller first.
create function everything_claude_review_rows(p_ids uuid[]) returns setof everything_claude_review_draft
language sql stable security definer set search_path = public as $$
  select d.id, d.item_id, d.passage, d.claim, d.kind, d.outcome, d.note, d.reasoning, d.sources,
         d.status, d.note_id, d.posted_as, d.reviewed_by, d.reviewed_at, d.created_at, d.context_paragraph,
         i.url, i.title, p.name,
         coalesce((
           select jsonb_agg(jsonb_build_object('at', e.at, 'actor', e.actor, 'text', coalesce(e.data ->> 'text', '')) order by e.id)
             from everything_claude_events e
            where e.draft_id = d.id and e.type in ('message', 'answer')
         ), '[]'::jsonb),
         -- Rewrites imported from the GOO-504 file log name the old text
         -- previousNote.
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'at', e.at,
                    'note', coalesce(e.data ->> 'previous_note', e.data ->> 'previousNote', e.data ->> 'note', ''),
                    'reason', coalesce(e.data ->> 'reason', e.data ->> 'reply', '')
                  ) order by e.id)
             from everything_claude_events e
            where e.draft_id = d.id
              and ((e.type = 'rewritten' and coalesce(e.data ->> 'previous_note', e.data ->> 'previousNote') is not null) or e.type = 'withdrawn')
         ), '[]'::jsonb)
    from everything_claude_drafts d
    join everything_items i on i.id = d.item_id
    left join everything_projects p on p.id = i.project_id
   where d.id = any (p_ids)
   order by d.created_at desc, d.id desc;
$$;

-- One page of a sidebar section, newest first.
create function everything_claude_review_page(
  p_section text,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 20
) returns setof everything_claude_review_draft
language plpgsql stable security definer set search_path = public as $$
declare
  max_page_size constant int := 50;
  v_status text;
  v_ids uuid[];
begin
  perform everything_claude_actor(null);
  v_status := case p_section
    when 'unreviewed' then 'posted'
    when 'approved' then 'posted'
    when 'waiting' then 'awaiting_approval'
    when 'rejected' then 'rejected'
    when 'no_note' then 'not_a_note'
  end;
  if v_status is null then raise exception 'Unknown section %', p_section; end if;
  -- The keyset: rows strictly after the last row of the previous page in the
  -- order (created_at desc, id desc), read straight off the section index.
  select array_agg(d.id) into v_ids
    from (
      select d.id
        from everything_claude_drafts d
       where d.status = v_status
         and (p_section <> 'unreviewed' or d.reviewed_by is null)
         and (p_section <> 'approved' or d.reviewed_by is not null)
         and (p_before_created_at is null or (d.created_at, d.id) < (p_before_created_at, p_before_id))
       order by d.created_at desc, d.id desc
       limit least(greatest(p_limit, 1), max_page_size)
    ) d;
  return query select * from everything_claude_review_rows(coalesce(v_ids, '{}'));
end;
$$;

-- A few drafts by id, so the page can refresh the ones whose chat waits for
-- Claude's answer without reloading every page.
create function everything_claude_review_drafts(p_ids uuid[]) returns setof everything_claude_review_draft
language plpgsql stable security definer set search_path = public as $$
declare
  max_ids constant int := 50;
begin
  perform everything_claude_actor(null);
  if cardinality(p_ids) > max_ids then raise exception 'Ask for at most % drafts', max_ids; end if;
  return query select * from everything_claude_review_rows(p_ids);
end;
$$;

-- 7. Who may call what.
--
-- Supabase grants every new function in the public schema to anon and
-- authenticated by default, so every grant is spelled out here. The page's
-- functions are open to signed-in accounts, and each refuses anyone who is
-- not an admin. The building blocks are for the service key only.

revoke all on function
  everything_claude_actor(text),
  everything_claude_publish(uuid, text, uuid, text),
  everything_claude_remove_note(uuid),
  everything_claude_approve(uuid, text),
  everything_claude_reject(uuid, text, text),
  everything_claude_rewrite(uuid, text, text, text, jsonb, text, text, jsonb, text),
  everything_claude_withdraw(uuid, text, text),
  everything_claude_message(uuid, text, text),
  everything_claude_change_settings(text, boolean, text),
  everything_claude_review_summary(),
  everything_claude_review_rows(uuid[]),
  everything_claude_review_page(text, timestamptz, uuid, int),
  everything_claude_review_drafts(uuid[])
from public, anon, authenticated;

grant execute on function
  everything_claude_approve(uuid, text),
  everything_claude_reject(uuid, text, text),
  everything_claude_rewrite(uuid, text, text, text, jsonb, text, text, jsonb, text),
  everything_claude_message(uuid, text, text),
  everything_claude_change_settings(text, boolean, text),
  everything_claude_review_summary(),
  everything_claude_review_page(text, timestamptz, uuid, int),
  everything_claude_review_drafts(uuid[])
to authenticated, service_role;

grant execute on function
  everything_claude_publish(uuid, text, uuid, text),
  everything_claude_remove_note(uuid),
  everything_claude_withdraw(uuid, text, text)
to service_role;
