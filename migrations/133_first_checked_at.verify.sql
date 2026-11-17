-- Checks migration 133 against its fixture (GOO-549). Every block raises an
-- exception when the first check is recorded wrongly.

-- The backfill finds the pipeline's check, not Claude's later re-checks and
-- not the 'other' run.
do $$
begin
  if (select first_checked_at from everything_items where id = '00000000-0000-0000-0000-0000000000a1') is distinct from '2026-10-21 05:30Z'::timestamptz then
    raise exception 'expected the backfill to find the first check at 05:30 on 21 October';
  end if;
end $$;

-- A later finish moves processed_at but not first_checked_at.
update everything_items set processed_at = '2026-10-24 09:00Z' where id = '00000000-0000-0000-0000-0000000000a1';
do $$
begin
  if (select first_checked_at from everything_items where id = '00000000-0000-0000-0000-0000000000a1') is distinct from '2026-10-21 05:30Z'::timestamptz then
    raise exception 'a re-check overwrote first_checked_at';
  end if;
end $$;

-- A new item gets its first check when it first becomes done as a page, and
-- not while it is queued.
insert into everything_items (id, project_id, url, status, checked_scope, priority, published_time, created_at)
  values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'https://thezvi.substack.com/p/fresh', 'queued', 'page', 1, '2026-10-24 10:00Z', '2026-10-24 10:20Z');
do $$
begin
  if (select first_checked_at from everything_items where id = '00000000-0000-0000-0000-0000000000a2') is not null then
    raise exception 'a queued item got a first check';
  end if;
end $$;
update everything_items set status = 'done', processed_at = '2026-10-24 10:45Z' where id = '00000000-0000-0000-0000-0000000000a2';
update everything_items set processed_at = '2026-10-25 08:00Z' where id = '00000000-0000-0000-0000-0000000000a2';
do $$
begin
  if (select first_checked_at from everything_items where id = '00000000-0000-0000-0000-0000000000a2') is distinct from '2026-10-24 10:45Z'::timestamptz then
    raise exception 'expected the first check at 10:45 on 24 October';
  end if;
end $$;

-- The ranking measures to the first check: of the posts the walk took after
-- its first item (from migration 132's verify file, 1 and 3 hours) and the two
-- here (about 9 hours and 45 minutes), the median is 2 hours.
do $$
declare r record;
begin
  select * into r from everything_creator_ranking(10, 1.0, 2, 2, 3, 1.07) where project_slug = 'thezvi';
  if r.delay_posts is distinct from 4 then
    raise exception 'expected four posts in the delay, got %', r.delay_posts;
  end if;
  if r.median_delay_hours is distinct from 2::float8 then
    raise exception 'expected a median of 2 hours, got %', r.median_delay_hours;
  end if;
end $$;
