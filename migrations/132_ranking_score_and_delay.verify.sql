-- Checks migration 132 against its fixture (GOO-549). Every block raises an
-- exception when the ranking measures the delay wrongly.

-- A reader asked for an old post first. That must not count as following the
-- creator: the walk's first item, a catch-up post, comes a day later.
insert into everything_items (project_id, url, status, checked_scope, priority, published_at, published_time, created_at, processed_at) values
  ('00000000-0000-0000-0000-000000000001', 'https://thezvi.substack.com/p/requested', 'done', 'page', 2, '2026-10-01', '2026-10-01 10:00Z', '2026-10-09 09:00Z', '2026-10-09 09:30Z'),
  ('00000000-0000-0000-0000-000000000001', 'https://thezvi.substack.com/p/catch-up', 'done', 'page', 1, '2026-10-09', '2026-10-09 12:00Z', '2026-10-10 08:00Z', '2026-10-10 08:10Z'),
  -- Two new posts, checked 1 hour and 3 hours after publication.
  ('00000000-0000-0000-0000-000000000001', 'https://thezvi.substack.com/p/new-1', 'done', 'page', 1, '2026-10-11', '2026-10-11 22:00Z', '2026-10-11 22:30Z', '2026-10-11 23:00Z'),
  ('00000000-0000-0000-0000-000000000001', 'https://thezvi.substack.com/p/new-2', 'done', 'page', 1, '2026-10-12', '2026-10-12 14:00Z', '2026-10-12 16:00Z', '2026-10-12 17:00Z'),
  -- A new post without an exact time, which must be left out.
  ('00000000-0000-0000-0000-000000000001', 'https://thezvi.substack.com/p/no-time', 'done', 'page', 1, '2026-10-13', null, '2026-10-13 09:00Z', '2026-10-14 09:00Z');

do $$
declare r record;
begin
  select * into r from everything_creator_ranking(10, 1.0, 2, 2, 3, 1.07) where project_slug = 'thezvi';
  if r.delay_posts is distinct from 2 then
    raise exception 'expected the two new posts to count, got %', r.delay_posts;
  end if;
  if r.median_delay_hours is distinct from 2::float8 then
    raise exception 'expected a median of 2 hours from the exact times, got %', r.median_delay_hours;
  end if;
end $$;

-- Only creators whose score with the imagined posts reaches 1 are walked,
-- besides those holding priority.
do $$
declare walked text[];
begin
  select array_agg(feed_url order by feed_url) into walked from everything_creator_ranking(10, 1.0, 2, 2, 3, 1.07);
  if walked is distinct from array['https://steady.substack.com', 'https://thezvi.substack.com'] then
    raise exception 'expected steady and thezvi to be walked, got %', walked;
  end if;
end $$;

-- The anon key keeps its access, since the dashboard calls this with it.
set role anon;
select count(*) from everything_creator_ranking(10, 1.0, 2, 2, 3, 1.07);
reset role;
