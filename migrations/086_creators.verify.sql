\set ON_ERROR_STOP on
\pset pager off
\echo '--- 1. every slug is now the one its URL derives to, and the rows kept their ids'
select slug, feed_url, priority_until is not null as has_window from everything_projects where feed_url is not null order by slug;
\echo '    (the item ingested under the old slug "zvi" must still hang off the renamed project)'
select p.slug, count(i.id) as items from everything_projects p join everything_items i on i.project_id = p.id group by p.slug;

\echo '--- 2. a deliberate manual flag was kept, not overwritten by created_at + 7d'
select slug, (priority_until > now()) as still_live from everything_projects where slug = 'thezvi';

\echo '--- 3. old rows arrive expired, recent ones still live'
select slug, (priority_until > now()) as still_live from everything_projects where slug in ('astralcodexten','kurzgesagt','nathanpmyoung') order by slug;

\echo '--- 4. OLD extension read: select feed_url from everything_followed_feeds'
set role anon;
select feed_url from everything_followed_feeds order by feed_url;
reset role;

\echo '--- 5. OLD extension write: the exact insert an old build sends'
set role anon;
insert into everything_follow_requests (feed_type, feed_url, title, user_id)
  values ('substack', 'https://oldclient.substack.com', 'Old Client', null);
reset role;
select slug, name, feed_url, round(extract(epoch from priority_until - now()) / 86400.0) as days
  from everything_projects where feed_url = 'https://oldclient.substack.com';

\echo '--- 6. NEW extension write: feed_url alone'
set role anon;
insert into everything_projects (feed_url) values ('https://newclient.substack.com');
reset role;
select slug, name, round(extract(epoch from priority_until - now()) / 86400.0) as days
  from everything_projects where feed_url = 'https://newclient.substack.com';

\echo '--- 7. anon cannot choose its own window'
set role anon;
\set ON_ERROR_STOP off
insert into everything_projects (feed_url, priority_until) values ('https://cheat.substack.com', now() + interval '3650 days');
\set ON_ERROR_STOP on
reset role;

\echo '--- 8. anon cannot name a project, and a second creator with the same handle gets a suffix'
set role anon;
insert into everything_projects (feed_url) values ('https://www.youtube.com/@thezvi');
reset role;
select slug, name from everything_projects where feed_url = 'https://www.youtube.com/@thezvi';

\echo '--- 9. re-press extends rather than duplicating, and never shortens'
update everything_projects set priority_until = now() + interval '30 days' where feed_url = 'https://newclient.substack.com';
set role anon;
insert into everything_projects (feed_url) values ('https://newclient.substack.com');
reset role;
select count(*) as rows_for_creator,
       round(extract(epoch from max(priority_until) - now()) / 86400.0) as days_left
  from everything_projects where feed_url = 'https://newclient.substack.com';

\echo '--- 10. anon cannot update or delete'
set role anon;
\set ON_ERROR_STOP off
update everything_projects set priority_until = now() + interval '3650 days' where feed_url is not null;
delete from everything_projects where feed_url is not null;
\set ON_ERROR_STOP on
reset role;

\echo '--- 11. a URL the parser cannot read is refused'
set role anon;
\set ON_ERROR_STOP off
insert into everything_projects (feed_url) values ('https://example.com/some-blog');
\set ON_ERROR_STOP on
reset role;

\echo '--- 12. the analytics function still runs after the drop'
select count(*) as rows_returned from everything_creator_visits(14);

\echo '--- 13. both old tables are gone, both shims are views'
select table_name, table_type from information_schema.tables
 where table_name in ('everything_followed_feeds','everything_follow_requests') order by table_name;
