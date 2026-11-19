-- 192: every claim keeps the paragraph around its passage.
--
-- The website shows the post's paragraph beside a note's card
-- (everything_claims.context_paragraph). Only the pipeline and the extension
-- ever filled it. The notewriters' notes go through everything_post_note and
-- everything_claude_publish, which never did, so no note written since the
-- pipeline stopped taking feed posts (2026-10-21) has a paragraph beside it.
--
-- A trigger now fills it on every new claim that comes without one, from the
-- post's text, whichever function inserts the claim. The claims that already
-- have a note and no paragraph are filled the same way.
--
-- everything_context_paragraph follows contextParagraph() in
-- src/claude-notes/store.ts, which fills the draft's paragraph for the review
-- page: the paragraph that holds the passage, or else its first 40
-- characters whatever their case, and of a paragraph over 3,000 characters (a
-- video's transcript) about 750 characters either side of the passage. It
-- looks for the passage itself instead of splitting the post, which took
-- 150 ms a claim on production's texts. A passage that is its whole paragraph
-- gets none, because the card already shows the passage.
--
-- UNDO: drop trigger everything_claims_context_paragraph on everything_claims;
--       drop function everything_fill_context_paragraph();
--       drop function everything_context_paragraph(text, text);
--       The filled paragraphs can stay: the pipeline's claims have them too.

begin;

create function everything_context_paragraph(p_text text, p_passage text) returns text
language plpgsql immutable as $$
declare
  v_passage text := btrim(p_passage);
  v_opening text := lower(left(v_passage, 40));
  v_at int;
  v_back int;
  v_fwd int;
  v_start int;
  p text;
begin
  if p_text is null or coalesce(v_passage, '') = '' then return null; end if;
  v_at := strpos(p_text, v_passage);
  if v_at = 0 then v_at := strpos(lower(p_text), v_opening); end if;
  if v_at = 0 then return null; end if;
  -- The paragraph runs from the blank line before the passage's start to the
  -- one after it.
  v_back := strpos(reverse(left(p_text, v_at - 1)), E'\n\n');
  v_start := case when v_back = 0 then 1 else v_at - v_back + 1 end;
  v_fwd := strpos(substr(p_text, v_at), E'\n\n');
  p := btrim(substr(p_text, v_start, case when v_fwd = 0 then length(p_text) else v_at + v_fwd - 1 - v_start end), E' \t\r\n');
  if regexp_replace(lower(p), '\s+', ' ', 'g') = regexp_replace(lower(v_passage), '\s+', ' ', 'g') then return null; end if;
  if length(p) <= 3000 then return p; end if;
  v_at := greatest(strpos(lower(p), v_opening), 1);
  return case when v_at > 750 then '… ' || regexp_replace(substr(p, v_at - 750, 750), '^\S*\s+', '') else left(p, v_at - 1) end
      || case when v_at + length(v_passage) + 750 <= length(p)
              then regexp_replace(substr(p, v_at, length(v_passage) + 750), '\s+\S*$', '') || ' …'
              else substr(p, v_at) end;
end;
$$;

create function everything_fill_context_paragraph() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.context_paragraph is null then
    select everything_context_paragraph(i.full_text, coalesce(new.context_quote, new.claim)) into new.context_paragraph
      from everything_items i where i.id = new.item_id;
  end if;
  return new;
end;
$$;

create trigger everything_claims_context_paragraph before insert on everything_claims
  for each row execute function everything_fill_context_paragraph();

revoke all on function everything_context_paragraph(text, text) from public, anon, authenticated;
revoke all on function everything_fill_context_paragraph() from public, anon, authenticated;

set local statement_timeout = 0;
update everything_claims c
   set context_paragraph = everything_context_paragraph(i.full_text, coalesce(c.context_quote, c.claim))
  from everything_items i
 where i.id = c.item_id and c.context_paragraph is null and i.full_text is not null
   and exists (select 1 from everything_notes n where n.claim_id = c.id);

commit;
