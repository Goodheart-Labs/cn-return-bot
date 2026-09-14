\set ON_ERROR_STOP on
\pset pager off

\echo '--- 1. the list as the website reads it, as anon'
\echo '    expected: Gamma 2, Zed 1.5, alpha 0. Beta has no item and is absent.'
\echo '    Zed must not count its author self-vote, its Not helpful vote, or the votes on its hidden note.'
set role anon;
select slug, name, vote_score from everything_projects_by_votes();
reset role;

\echo '--- 2. the anon role still cannot read the votes table itself'
\echo '    expected: permission denied'
set role anon;
\set ON_ERROR_STOP off
select count(*) from everything_votes;
\set ON_ERROR_STOP on
reset role;

\echo '--- 3. a tie is broken by name, ignoring case'
\echo '    Zed gets one more Somewhat helpful vote, so it ties with Gamma at 2, and Gamma is renamed to lower case.'
\echo '    expected: gamma 2, Zed 2, alpha 0. With a case-sensitive order Zed would come before gamma.'
insert into everything_votes (note_id, voter_id, vote) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000e4', 0);
update everything_projects set name = 'gamma' where slug = 'gamma';
set role anon;
select slug, name, vote_score from everything_projects_by_votes();
reset role;
