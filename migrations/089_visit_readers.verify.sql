\set ON_ERROR_STOP on
\pset pager off

\echo '--- 0. the browser can still write a visit, now with a reader hash, and still cannot read one back'
-- Reader A reads two different Zvi posts, so they are a regular reader.
-- Reader B opens one Zvi post twice, so they are a reader and not a regular
-- one. That is the case raw visit counting used to get wrong.
-- Reader A also watches two Kurzgesagt videos, under a hash of their own, and
-- the second row spells the channel with different capitals and a trailing
-- slash. One creator, one reader, and it must not count as two.
set role anon;
insert into everything_link_visits (url, feed_url, reader_hash, visited_at) values
  ('https://thezvi.substack.com/p/one', 'https://thezvi.substack.com', repeat('a', 64), now() - interval '1 day'),
  ('https://thezvi.substack.com/p/two', 'https://thezvi.substack.com', repeat('a', 64), now() - interval '1 day'),
  ('https://thezvi.substack.com/p/one', 'https://thezvi.substack.com', repeat('b', 64), now() - interval '2 days'),
  ('https://thezvi.substack.com/p/one', 'https://thezvi.substack.com', repeat('b', 64), now() - interval '2 days'),
  ('https://www.youtube.com/watch?v=abc', 'https://www.youtube.com/@kurzgesagt', repeat('c', 64), now() - interval '1 day'),
  ('https://www.youtube.com/watch?v=def', 'https://www.youtube.com/@Kurzgesagt/', repeat('c', 64), now() - interval '1 day');
\set ON_ERROR_STOP off
select count(*) from everything_link_visits;
\set ON_ERROR_STOP on
reset role;

\echo '--- 1. a value that is not a 64-character hash is refused by the column'
\set ON_ERROR_STOP off
insert into everything_link_visits (url, feed_url, reader_hash) values ('https://x.substack.com/p/a', 'https://x.substack.com', 'not-a-hash');
\set ON_ERROR_STOP on

\echo '--- 2. the numbers per creator over the last 14 days, with two pages needed for a regular reader'
\echo '    expected: thezvi visits 5, pages 2, readers 2, regular readers 1'
\echo '              youtube.com/@kurzgesagt visits 2, pages 2, readers 1, regular readers 1'
select feed_url, visits, pages, readers, regular_readers
  from everything_creator_attention(now() - interval '14 days', 2) order by feed_url;

\echo '--- 3. raising the bar to three pages leaves nobody a regular reader'
select feed_url, regular_readers from everything_creator_attention(now() - interval '14 days', 3) order by feed_url;

\echo '--- 4. the two-reader proof: true, because thezvi has two different readers'
select everything_two_readers_seen() as proof;

\echo '--- 5. with the second Zvi reader removed the proof is false again, so a fresh install starts on the old rule'
begin;
delete from everything_link_visits where reader_hash = repeat('b', 64);
select everything_two_readers_seen() as proof;
rollback;

\echo '--- 6. the old function is gone, so nothing can silently keep calling it'
select count(*) as should_be_zero from pg_proc where proname = 'everything_visit_counts';

\echo '--- 7. the dashboard function, read as anon, carries the two new columns'
set role anon;
select creator, visits, readers, regular_readers from everything_creator_visits(14) order by creator;
reset role;

\echo '--- 8. anon still cannot read the visit rows themselves'
set role anon;
\set ON_ERROR_STOP off
select count(*) from everything_link_visits;
\set ON_ERROR_STOP on
reset role;
