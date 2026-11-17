-- Checks migration 135 (GOO-549). Run after the fixtures, migrations and
-- verify files of 132 to 134 (see 134_ranking_average_readers.fixture.sql),
-- then this migration and this file. There is no fixture of its own: the view
-- reads migration 134's stand-in for everything_creator_visit_scores.

-- The view holds what the function returned when it was created.
do $$
begin
  if (select count(*) from everything_creator_visits) <> 24 then
    raise exception 'expected the view to hold the 24 creators of the fixture';
  end if;
end $$;

-- The ranking reads the view: a creator added to the visits after the last
-- refresh is not ranked until the next refresh.
create or replace function everything_creator_visit_scores(last_posts int)
returns table (feed_url text, visitors_per_post float8, posts bigint, people bigint)
language sql stable as $$
  select * from (values ('https://newcomer.substack.com', 9.0::float8, 10::bigint, 30::bigint)) v
  union all
  select s.feed_url, s.visitors_per_post, s.posts, s.people from everything_creator_visits s
$$;
do $$
begin
  if exists (select 1 from everything_creator_ranking(10, 1.0, 2, 2, 3) where feed_url = 'https://newcomer.substack.com') then
    raise exception 'the ranking saw a creator before the refresh';
  end if;
end $$;
refresh materialized view concurrently everything_creator_visits;
do $$
begin
  if not exists (select 1 from everything_creator_ranking(10, 1.0, 2, 2, 3) where feed_url = 'https://newcomer.substack.com') then
    raise exception 'the ranking missed a creator after the refresh';
  end if;
end $$;

-- The anon key cannot read the view directly, only through the ranking.
set role anon;
do $$
begin
  perform 1 from everything_creator_visits;
  raise exception 'anon could read everything_creator_visits';
exception when insufficient_privilege then null;
end $$;
select count(*) from everything_creator_ranking(10, 1.0, 2, 2, 3);
reset role;
