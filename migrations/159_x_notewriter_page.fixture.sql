-- A miniature of production for migration 159: migration 153's miniature with
-- 153 applied, so the review page's functions can be checked on the new
-- helpers with 153's own verify file, plus the X tables the page reads.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/159_x_notewriter_page.fixture.sql
--   $PSQL --single-transaction -f migrations/159_x_notewriter_page.sql
--   $PSQL -f migrations/153_review_fields.verify.sql
--   $PSQL -f migrations/159_x_notewriter_page.verify.sql
--
-- The notes: n1 helpful on 20 Oct by bot a and search s1, n2 not helpful on
-- 21 Oct by bot a and search s2 with a reviewer's failure mode, n3 needing
-- ratings on 27 Oct by bot b from before the search test existed, and n4 on
-- 28 Oct with no known run. A rejected run of bot a also drew the retired
-- test "old", and a run of bot b is still in progress.
\ir 153_review_fields.fixture.sql
\ir 153_review_fields.sql

create table notes (
  note_id text primary key, tweet_id text, note_text text, cn_status text, view_count int, submitted_at timestamptz
);
create table pipeline_runs (
  id uuid primary key default gen_random_uuid(), tweet_id text, note_id text, outcome text, cost numeric,
  ab_test_picks jsonb, created_at timestamptz not null default now()
);
create table tweets (
  tweet_id text primary key, text text, author_handle text, author_name text, posted_at timestamptz,
  media jsonb, referenced_tweet_data jsonb, referenced_tweets jsonb
);
create table note_ratings_from_public_dump (
  note_id text primary key, helpful_count int, somewhat_helpful_count int, not_helpful_count int,
  helpful_tag_counts jsonb, not_helpful_tag_counts jsonb
);
create table review_dashboard_annotations (
  id uuid primary key default gen_random_uuid(), source text, target_id text, seen boolean, failure_modes text[]
);
create table daily_note_origin_counts (day date primary key, helpful_total int, helpful_ours int, helpful_other_ai int);

insert into notes values
  ('n1', 't1', 'Note one https://a.example', 'CURRENTLY_RATED_HELPFUL', 100, '2026-10-20 10:00Z'),
  ('n2', 't2', 'Note two', 'CURRENTLY_RATED_NOT_HELPFUL', 10, '2026-10-21 10:00Z'),
  ('n3', 't3', 'Note three', 'NEEDS_MORE_RATINGS', 0, '2026-10-27 10:00Z'),
  ('n4', 't4', 'Note four', 'NEEDS_MORE_RATINGS', 0, '2026-10-28 10:00Z'),
  ('n5', 't5', 'Never submitted', 'NEEDS_MORE_RATINGS', 0, null);
insert into pipeline_runs (tweet_id, note_id, outcome, cost, ab_test_picks, created_at) values
  ('t1', 'n1', 'submitted', 0.5, '{"bot": "a", "search": "s1"}', '2026-10-20 09:50Z'),
  ('t2', 'n2', 'submitted', 0.25, '{"bot": "a", "search": "s2"}', '2026-10-21 09:50Z'),
  ('t3', 'n3', 'submitted', 0.25, '{"bot": "b"}', '2026-10-27 09:50Z'),
  ('t6', null, 'rejected', 0.125, '{"bot": "a", "search": "s1", "old": "x"}', '2026-10-21 08:00Z'),
  ('t7', null, 'in_progress', null, '{"bot": "b"}', now());
insert into tweets values
  ('t1', 'Post one', 'alice', 'Alice', '2026-10-20 08:00Z', '[{"type": "photo", "url": "https://pbs.example/1.jpg"}]',
   '{"text": "Quoted", "media": []}', '[{"type": "quoted", "id": "q1"}]');
insert into note_ratings_from_public_dump values
  ('n1', 5, 1, 1, '{"helpfulGoodSources": 3}', '{"notHelpfulIncorrect": 1}');
insert into review_dashboard_annotations (source, target_id, seen, failure_modes) values
  ('production', 'n2', true, '{hallucination}'),
  ('production', 'n3', false, '{}');
insert into daily_note_origin_counts values ('2026-10-20', 100, 2, 3);
