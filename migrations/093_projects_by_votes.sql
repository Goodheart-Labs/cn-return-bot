-- 093: the website's project list, ordered by how many votes each project's
-- notes have received.
--
-- The sidebar on commonnotes.net lists every project that has content. Until
-- now the site read the project table ordered by sort_order and then read the
-- project id of every item to drop the projects without content. Jim asked for
-- the list to be ordered by votes instead, and votes live in everything_votes,
-- which the anon key cannot read. So this function does both steps in the
-- database and returns only the aggregate.
--
-- A vote counts when it was cast on a note that is not hidden. The vote a
-- trigger casts automatically for an author on their own note (migration 058)
-- does not count, because it says nothing about the project. Votes on
-- "note not needed" entries do not count either: the sidebar ranks projects by
-- how much their notes are being rated.
--
-- Ties, which include every project nobody has voted on yet, fall back to
-- sort_order and then to the name, so the order is stable between page loads.

create or replace function everything_projects_by_votes()
returns table (id uuid, slug text, name text, votes bigint)
language sql
stable
security definer
set search_path = public
as $$
  with project_votes as (
    select i.project_id, count(*) as votes
    from everything_votes v
    join everything_notes n on n.id = v.note_id
    join everything_claims c on c.id = n.claim_id
    join everything_items i on i.id = c.item_id
    where v.voter_id is distinct from n.author_id
      and n.status <> 'hidden'
    group by i.project_id
  )
  select p.id, p.slug, p.name, coalesce(pv.votes, 0)
  from everything_projects p
  left join project_votes pv on pv.project_id = p.id
  where exists (select 1 from everything_items i where i.project_id = p.id)
  order by coalesce(pv.votes, 0) desc, p.sort_order, p.name
$$;

comment on function everything_projects_by_votes() is
  'The projects that have at least one item, with the number of votes cast on their notes (author self-votes and hidden notes excluded), most-voted first. Read by the website sidebar.';

-- 050 revoked default function privileges, so grant execute back explicitly.
revoke all on function everything_projects_by_votes() from public;
grant execute on function everything_projects_by_votes() to anon, authenticated;
