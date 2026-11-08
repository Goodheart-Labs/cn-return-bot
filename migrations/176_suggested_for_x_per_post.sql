-- 176: the X suggestions of migration 175 may hold several notes on one post.
--
-- Migration 175 kept only the best candidate per post, on the belief that
-- Nathan never posted two notes on one post on the same day. That was wrong:
-- on 2026-09-24 he posted two notes on one post, and on 2026-10-30 and
-- 2026-11-01 two on "Links For October 2026". Replaying the rule at the
-- moment each of the 22 posted notes went out, with the votes it had then,
-- 9 of them were among the five suggestions with one note per post, and 12
-- without that limit. The other parts of the rule stay as in 175.
--
-- Of the 10 misses without the limit, 7 were more than 14 days old when they
-- went out (6 of them from the catch-up of old notes in late September), and
-- 3 ranked 7th, 8th and 14th.

create or replace function everything_x_suggestions() returns table (note_id uuid)
language sql stable security definer set search_path = public as $$
  select n.id
    from everything_notes n
    left join everything_best_notes b on b.note_id = n.id
   where n.status <> 'hidden'
     and n.claim_id is not null
     and n.improved_from_note_id is null
     and n.feed_band is distinct from 'stale'
     and (b.note_id is not null or (n.p_helpful >= 0.74 and n.created_at >= now() - interval '14 days'))
     and not exists (select 1 from everything_note_x_marks x where x.note_id = n.id)
     and not exists (
       select 1 from everything_votes v
        where v.note_id = n.id and v.vote < 0 and everything_reviewer_of(v.voter_id) is not null
     )
   order by n.p_helpful desc, n.helpful_count desc, n.created_at desc
   limit 5;
$$;

notify pgrst, 'reload schema';
