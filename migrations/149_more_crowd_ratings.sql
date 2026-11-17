-- 149: two more crowd ratings on the review page's filter (GOO-563).
--
-- Besides "rated helpful", "only upvotes" and "everything else", the filter
-- now also offers "rated not helpful" and "only downvotes": notes with Not
-- helpful votes and no Helpful or Somewhat helpful vote. As before, the
-- author's own automatic vote does not count.

create or replace function everything_claude_crowd_rating(p_note uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
             when everything_note_status(n.p_helpful) = 'helpful' then 'helpful'
             when everything_note_status(n.p_helpful) = 'not_helpful' then 'not_helpful'
             when n.not_helpful_count = 0 and upvotes > 0 then 'upvoted'
             when n.not_helpful_count > 0 and upvotes = 0 then 'downvoted'
             else 'other'
           end
      from everything_notes n,
           lateral (select n.helpful_count - (n.author_id is not null)::int + n.somewhat_helpful_count as upvotes) u
     where n.id = p_note
  ), 'other')
$$;
