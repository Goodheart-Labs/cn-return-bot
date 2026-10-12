-- 106: a picture for every creator, and the projects overview on commonnotes.net.
--
-- The website's Notes page becomes an overview of all projects: each with the
-- creator's picture, a link to their Substack, YouTube channel or LessWrong
-- profile, and the project's Common Notes page. Nothing stored a creator's
-- picture until now, and the browser cannot fetch one itself (the YouTube API
-- needs our key, and Substack refuses requests from other websites).
--
-- avatar_url is the picture: a Substack publication's logo from its RSS feed,
-- a YouTube channel's profile picture from the Data API, or a LessWrong
-- author's profile picture. Null means we have none, and the website draws the
-- project's initial instead.
--
-- avatar_refreshed_at is when the pipeline last tried to fetch it, whether or
-- not it found one. Every feed run refreshes a few projects whose attempt is
-- missing or older than 30 days (src/everything/projectAvatars.ts), so a
-- creator who changes their picture shows the new one within a month.
--
-- everything_projects_by_votes (migration 094) is what the website reads for
-- its project list. It now also returns the feed URL, the picture and the
-- number of visible notes, so the overview needs no second query. The ranking
-- itself is unchanged. The return type changes, so the function is dropped
-- and created again rather than replaced. The website deployed before this
-- migration reads only the old columns and keeps working.

alter table everything_projects
  add column avatar_url text,
  add column avatar_refreshed_at timestamptz;

comment on column everything_projects.avatar_url is
  'The creator''s picture: Substack publication logo, YouTube channel picture or LessWrong profile picture. Null when none is known.';
comment on column everything_projects.avatar_refreshed_at is
  'When the pipeline last tried to fetch avatar_url, successful or not. Refreshed when older than 30 days.';

drop function if exists everything_projects_by_votes();

create function everything_projects_by_votes()
returns table (id uuid, slug text, name text, feed_url text, avatar_url text, vote_score numeric, note_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with project_notes as (
    select i.project_id, n.id as note_id, n.author_id
    from everything_notes n
    join everything_claims c on c.id = n.claim_id
    join everything_items i on i.id = c.item_id
    where n.status <> 'hidden'
  ),
  project_scores as (
    select pn.project_id,
           sum(case v.vote when 1 then 1 when 0 then 0.5 else 0 end) as vote_score
    from everything_votes v
    join project_notes pn on pn.note_id = v.note_id
    where v.voter_id is distinct from pn.author_id
    group by pn.project_id
  ),
  project_counts as (
    select project_id, count(*) as note_count from project_notes group by project_id
  )
  select p.id, p.slug, p.name, p.feed_url, p.avatar_url,
         coalesce(ps.vote_score, 0), coalesce(pc.note_count, 0)
  from everything_projects p
  left join project_scores ps on ps.project_id = p.id
  left join project_counts pc on pc.project_id = p.id
  where exists (select 1 from everything_items i where i.project_id = p.id)
  order by coalesce(ps.vote_score, 0) desc, lower(p.name)
$$;

comment on function everything_projects_by_votes() is
  'The projects that have at least one item, with their feed URL, picture, number of visible notes and the score of the votes on their notes (Helpful 1, Somewhat helpful 0.5, Not helpful 0; author self-votes and hidden notes excluded), highest score first and ties by name. Read by the website''s projects overview.';

-- 050 revoked default function privileges, so grant execute back explicitly.
revoke all on function everything_projects_by_votes() from public;
grant execute on function everything_projects_by_votes() to anon, authenticated;
