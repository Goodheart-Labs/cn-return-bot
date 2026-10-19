\set ON_ERROR_STOP on
\pset pager off

\echo '--- 1. the overview as the website reads it, as anon'
\echo '    expected: Gamma 2 with 1 note, Zed 1.5 with 1 note (its hidden note is not counted), alpha 0 with 1 note.'
\echo '    Beta has no item and is absent. Only Zed has a feed URL. No project has a picture yet.'
set role anon;
select slug, name, feed_url, avatar_url, vote_score, note_count from everything_projects_by_votes();
reset role;

\echo '--- 2. a stored picture comes through'
\echo '    expected: Zed now carries https://example.com/zed.png'
update everything_projects set avatar_url = 'https://example.com/zed.png', avatar_refreshed_at = now() where slug = 'zed';
set role anon;
select slug, avatar_url from everything_projects_by_votes() where slug = 'zed';
reset role;
