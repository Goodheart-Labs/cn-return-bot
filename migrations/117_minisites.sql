-- Minisites and admins (GOO-374).
--
-- A minisite is one article shown on commonnotes.net/minisites/<slug> with a
-- chosen set of reader features. Admins create them from a pasted link. The
-- website writes a job row, the intake service reads the page and writes the
-- result back into the row, and the admin then creates the minisite from that
-- result. The fact-check is a separate step an admin starts later.

-- 1. Admins.
--
-- An admin is anyone signed in with one of these email addresses. An email is
-- the one thing that stays the same when someone signs in on a new device or
-- with a second method. Anonymous accounts have no email, so they never match.
-- No client may read or write this table. Clients ask everything_is_admin().

create table everything_admins (
  email    text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

alter table everything_admins enable row level security;
revoke all on everything_admins from anon, authenticated;

insert into everything_admins (email) values
  ('jimmaar1@gmail.com'),
  ('nathanpmyoung@gmail.com'),
  ('nathan@goodheartlabs.com');

-- The function runs with its owner's rights (SECURITY DEFINER), so it can read
-- the table the caller cannot. It reads the caller's email from the sign-in
-- token that PostgREST hands to Postgres.
create function everything_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     and exists (select 1 from everything_admins where email = lower(auth.jwt() ->> 'email'));
$$;

revoke execute on function everything_is_admin() from public;
grant execute on function everything_is_admin() to anon, authenticated, service_role;

-- 2. Minisites.

create table everything_minisites (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique
               check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80 and slug <> 'new'),
  item_id      uuid not null unique references everything_items (id) on delete cascade,
  title        text not null check (length(title) between 1 and 300),
  description  text not null default '' check (length(description) <= 1000),
  byline       text check (length(byline) <= 300),
  published_at timestamptz,
  image_url    text check (image_url ~ '^https?://'),
  content      text not null,
  features     text[] not null default '{}',
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column everything_minisites.content is
  'The article in reader text: a small markdown subset with links, emphasis, quotes, lists, figures, tables and footnotes (src/everything-core/readerText.ts). The item keeps the plain text the pipeline reads.';
comment on column everything_minisites.features is
  'Ids of the switched-on reader features (src/everything-core/minisiteFeatures.ts). Unknown ids are ignored.';

alter table everything_minisites enable row level security;

create policy minisites_read on everything_minisites for select to anon, authenticated using (true);
grant select on everything_minisites to anon, authenticated;

-- Admins may change what a minisite shows, but not which article it is or its
-- address. New minisites only come from everything_create_minisite.
create policy minisites_admin_update on everything_minisites for update to authenticated
  using (everything_is_admin()) with check (everything_is_admin());
grant update (title, description, features, image_url, updated_at) on everything_minisites to authenticated;

create policy minisites_admin_delete on everything_minisites for delete to authenticated
  using (everything_is_admin());
grant delete on everything_minisites to authenticated;

-- 3. Jobs the website hands to the intake service.
--
-- read_page: read the page at url and write title, description, picture,
-- byline, date, reader text and plain text into result.
-- fact_check: written by everything_start_minisite_check. Its only purpose is
-- to wake the intake service at once; the item itself is already queued.

create table everything_minisite_jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('read_page', 'fact_check')),
  url          text check (url ~ '^https?://' and length(url) <= 2000),
  minisite_id  uuid references everything_minisites (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  result       jsonb,
  error        text,
  requested_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  check ((kind = 'read_page') = (url is not null))
);

create index everything_minisite_jobs_pending_idx on everything_minisite_jobs (created_at) where status = 'pending';

alter table everything_minisite_jobs enable row level security;

create policy minisite_jobs_admin_insert on everything_minisite_jobs for insert to authenticated
  with check (everything_is_admin() and kind = 'read_page' and requested_by = auth.uid());
create policy minisite_jobs_admin_read on everything_minisite_jobs for select to authenticated
  using (everything_is_admin() and requested_by = auth.uid());
grant insert (kind, url) on everything_minisite_jobs to authenticated;
grant select on everything_minisite_jobs to authenticated;

-- The website watches its job for the result, and the intake service watches
-- for new jobs. Realtime applies the select policy above to each listener.
alter publication supabase_realtime add table everything_minisite_jobs;

-- 4. Creating a minisite from a finished read_page job.
--
-- It reuses the article when Common Notes already has the address, so the
-- article's notes, key points and forecasts carry over. Otherwise it inserts
-- the article as unchecked, with the plain text as its body, under the
-- creator's project when the page named one and under "Around the web"
-- otherwise. Then it inserts the minisite. Everything happens in one
-- transaction, so a failed create leaves nothing behind.

create function everything_create_minisite(
  job_id uuid, new_slug text, new_title text, new_description text, new_features text[]
) returns text
language plpgsql security definer set search_path = public as $$
declare
  job everything_minisite_jobs;
  page_url text;
  found_item uuid;
  project uuid;
begin
  if not everything_is_admin() then
    raise exception 'only admins can create minisites' using errcode = 'insufficient_privilege';
  end if;
  select * into job from everything_minisite_jobs where id = job_id;
  if not found or job.kind <> 'read_page' or job.status <> 'done' or job.result is null then
    raise exception 'the page has not been read yet' using errcode = 'check_violation';
  end if;

  page_url := regexp_replace(job.url, '/+$', '');
  select id into found_item from everything_items where url in (page_url, page_url || '/') limit 1;
  if found_item is null then
    if coalesce(job.result ->> 'creator_feed_url', '') <> '' then
      project := everything_creator_project(job.result ->> 'creator_feed_url');
    else
      select id into project from everything_projects where slug = 'web';
    end if;
    insert into everything_items (project_id, source, url, title, status, full_text, published_at)
    values (project, 'web', page_url, new_title, 'done', job.result ->> 'plain_text',
            nullif(job.result ->> 'published_at', '')::timestamptz)
    returning id into found_item;
  end if;

  insert into everything_minisites (slug, item_id, title, description, byline, published_at, image_url, content, features, created_by)
  values (
    new_slug, found_item, btrim(new_title), btrim(coalesce(new_description, '')),
    nullif(job.result ->> 'byline', ''), nullif(job.result ->> 'published_at', '')::timestamptz,
    nullif(job.result ->> 'image_url', ''), job.result ->> 'content', coalesce(new_features, '{}'), auth.uid()
  );
  return new_slug;
end;
$$;

revoke execute on function everything_create_minisite(uuid, text, text, text, text[]) from public, anon;
grant execute on function everything_create_minisite(uuid, text, text, text, text[]) to authenticated, service_role;

-- 5. Starting the fact-check of a minisite's article.
--
-- It queues the article at the reader-request tier (priority 2) as a whole-page
-- check and keeps its text. A reader request is not used, because a request on
-- an article that is on Common Notes but unchecked replaces the article's text.

create function everything_start_minisite_check(target_minisite uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  target_item everything_items;
begin
  if not everything_is_admin() then
    raise exception 'only admins can start a fact-check' using errcode = 'insufficient_privilege';
  end if;
  select i.* into target_item from everything_items i join everything_minisites m on m.item_id = i.id where m.id = target_minisite;
  if not found then
    raise exception 'no such minisite' using errcode = 'no_data_found';
  end if;
  if target_item.status in ('queued', 'processing') then
    return;
  end if;
  if target_item.checked_scope = 'page' and target_item.status = 'done' then
    raise exception 'this article was already fact-checked' using errcode = 'check_violation';
  end if;
  update everything_items
     set status = 'queued', priority = 2, checked_scope = 'page', error = null
   where id = target_item.id;
  insert into everything_minisite_jobs (kind, minisite_id, requested_by) values ('fact_check', target_minisite, auth.uid());
end;
$$;

revoke execute on function everything_start_minisite_check(uuid) from public, anon;
grant execute on function everything_start_minisite_check(uuid) to authenticated, service_role;
