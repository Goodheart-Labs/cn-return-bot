-- A reader's first note on an unchecked page goes under the page's creator
-- (GOO-290).
--
-- When a reader writes a note on a page we have never checked, the extension
-- creates the page's item itself. The insert policy from migrations 068 and
-- 081 lets a signed-in client create a 'web' item under any project, but the
-- extension always chose "Around the web", because a client cannot create a
-- creator's project. The only client path into everything_projects is the
-- priority press (migration 086), and that also grants the creator 7 days of
-- priority, which writing a note must not do.
--
-- This function returns the project for a creator's feed URL and creates the
-- project when we have never met that creator. The new project gets the slug
-- the press trigger would give it, its slug as a placeholder name, and no
-- priority. The pipeline fills in the real name later (projectAvatars.ts).
--
-- It is SECURITY DEFINER, so it runs with its owner's rights rather than the
-- caller's. Inside it, current_user is the owner, so the press trigger lets the
-- insert through untouched and grants no priority. Only signed-in clients may
-- call it. Writing a note needs a session anyway, and the extension signs a
-- reader in anonymously when they have none.

create or replace function everything_creator_project(creator_feed_url text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  feed text := regexp_replace(btrim(coalesce(creator_feed_url, '')), '/+$', '');
  base_slug text := everything_feed_slug(feed);
  candidate text;
  suffix int := 1;
  found_id uuid;
begin
  if base_slug is null then
    raise exception 'not a creator feed we recognise: %', creator_feed_url using errcode = 'check_violation';
  end if;

  -- Feed URLs are compared ignoring case, as everywhere else (migration 086).
  -- A YouTube handle arrives in whatever case the page wrote it.
  select id into found_id from everything_projects where lower(feed_url) = lower(feed);
  if found then
    return found_id;
  end if;

  candidate := base_slug;
  while exists (select 1 from everything_projects where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix;
  end loop;

  insert into everything_projects (slug, name, feed_url)
  values (candidate, base_slug, feed)
  returning id into found_id;
  return found_id;
exception when unique_violation then
  -- Two readers created the same creator's project at the same moment. The
  -- other insert won, so its row is the answer.
  select id into found_id from everything_projects where lower(feed_url) = lower(feed);
  if found_id is null then
    raise;
  end if;
  return found_id;
end;
$$;

comment on function everything_creator_project(text) is
  'Project id for a creator feed URL, creating the project without priority when it is new. Used by the extension when a reader writes the first note on an unchecked page.';

revoke execute on function everything_creator_project(text) from public, anon;
grant execute on function everything_creator_project(text) to authenticated;
