-- 094: the website's project list, ordered by the votes on each project's notes.
--
-- The sidebar on commonnotes.net lists every project that has content. Until
-- now the site read the project table ordered by sort_order and then read the
-- project id of every item to drop the projects without content. Jim asked for
-- the list to be ordered by votes instead. Votes live in everything_votes,
-- which the anon key cannot read, so this function does both steps in the
-- database and returns only the aggregate.
--
-- A project's score is the sum over the votes on its visible notes: a Helpful
-- vote counts 1, a Somewhat helpful vote counts 0.5, and a Not helpful vote
-- counts nothing (Jim, 2026-09-14). The vote a trigger casts for an author on
-- their own note (migration 058) does not count, because it says nothing about
-- the project. Votes on "note not needed" entries do not count either: the
-- sidebar ranks projects by how their notes are being rated.
--
-- Ties, which include every project nobody has voted on yet, are ordered by
-- name, so the order is stable between page loads and a reader can find a
-- project by eye.
--
-- The unmerged PR #455 applied an earlier version of this function to
-- production that counted every vote once and broke ties by sort_order. Its
-- return type differs, so it is dropped rather than replaced.

drop function if exists everything_projects_by_votes();

create function everything_projects_by_votes()
returns table (id uuid, slug text, name text, vote_score numeric)
language sql
stable
security definer
set search_path = public
as $$
  with project_scores as (
    select i.project_id,
           sum(case v.vote when 1 then 1 when 0 then 0.5 else 0 end) as vote_score
    from everything_votes v
    join everything_notes n on n.id = v.note_id
    join everything_claims c on c.id = n.claim_id
    join everything_items i on i.id = c.item_id
    where v.voter_id is distinct from n.author_id
      and n.status <> 'hidden'
    group by i.project_id
  )
  select p.id, p.slug, p.name, coalesce(ps.vote_score, 0)
  from everything_projects p
  left join project_scores ps on ps.project_id = p.id
  where exists (select 1 from everything_items i where i.project_id = p.id)
  order by coalesce(ps.vote_score, 0) desc, lower(p.name)
$$;

comment on function everything_projects_by_votes() is
  'The projects that have at least one item, with the score of the votes on their notes (Helpful 1, Somewhat helpful 0.5, Not helpful 0; author self-votes and hidden notes excluded), highest first and ties by name. Read by the website sidebar.';

-- 050 revoked default function privileges, so grant execute back explicitly.
revoke all on function everything_projects_by_votes() from public;
grant execute on function everything_projects_by_votes() to anon, authenticated;
