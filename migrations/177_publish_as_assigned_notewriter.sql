-- 177: an AI note is recorded under the notewriter that held the post.
--
-- Migration 168 posted every Claude draft as notewriter claude-ai-box. Since
-- 2026-11-07 a second runner (CN_NOTEWRITER=claude-hq-nathan, posts only)
-- writes most of them: of the 178 AI notes posted 2026-11-06 to 11-08, 176
-- were on a post whose open assignment was claude-hq-nathan's, and all 178
-- were recorded as claude-ai-box. The draft row carries no notewriter, but
-- the post's open assignment names it. Same signature as 168, so callers and
-- grants stay. Older notes are not rewritten here.

create or replace function everything_claude_publish(p_draft uuid, p_posted_as text, p_actor text, p_author uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  d everything_claude_drafts;
  v_item_url text;
  v_claim uuid;
  v_note uuid;
  v_posted jsonb;
  v_notewriter text;
begin
  select * into d from everything_claude_drafts where id = p_draft for update;
  if not found then raise exception 'There is no draft %', p_draft; end if;
  if (p_posted_as = 'ai') <> (p_author is null) then
    raise exception 'An AI note has no author, and a person''s note needs one';
  end if;
  if p_posted_as = 'ai' then
    -- The notewriter holding the post writes the note; a draft posted from
    -- the review page after its assignment ended stays with claude-ai-box.
    select a.notewriter_id into v_notewriter
      from everything_assignments a
     where a.item_id = d.item_id and a.ended_at is null
     order by a.started_at desc limit 1;
    v_posted := notewriter_add_note(coalesce(v_notewriter, 'claude-ai-box'), d.item_id, jsonb_build_object(
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
