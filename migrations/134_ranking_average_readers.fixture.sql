-- Testing migration 134 (GOO-549) runs after the fixtures, migrations and
-- verify files of 132 and 133:
--   for f in 132_ranking_score_and_delay.fixture.sql 132_ranking_score_and_delay.sql 132_ranking_score_and_delay.verify.sql \
--            133_first_checked_at.fixture.sql 133_first_checked_at.sql 133_first_checked_at.verify.sql \
--            134_ranking_average_readers.fixture.sql 134_ranking_average_readers.sql 134_ranking_average_readers.verify.sql; do
--     PGPASSWORD=test psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 --single-transaction -f migrations/$f; done
--
-- It gives the visit scores a realistic population: besides migration 132's
-- four creators, twenty with one reader on each of 10 posts, as most visited
-- creators have, and lowish at 1.1. The average is then (40 + 13 + 11 + 8 + 200) / 231, about
-- 1.178 readers per post.

create or replace function everything_creator_visit_scores(last_posts int)
returns table (feed_url text, visitors_per_post float8, posts bigint, people bigint)
language sql stable as $$
  values ('https://thezvi.substack.com', 4.0::float8, 10::bigint, 40::bigint),
         ('https://steady.substack.com', 1.3::float8, 10::bigint, 5::bigint),
         ('https://lowish.substack.com', 1.1::float8, 10::bigint, 4::bigint),
         ('https://onepost.substack.com', 8.0::float8, 1::bigint, 8::bigint)
  union all
  select 'https://typical-' || n || '.substack.com', 1.0::float8, 10::bigint, 1::bigint from generate_series(1, 20) n
$$;
