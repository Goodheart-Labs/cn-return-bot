-- Fold the "Requested by readers" project into "Around the web" (GOO-19).
-- Reader-requested pages and write-anywhere pages are the same kind of
-- catch-all content, so they now share the one 'web' project from migration
-- 068. The request consumer enqueues new requested pages under 'web' as of
-- this change; this migration moves the already-ingested items over and
-- deletes the now-empty project that migration 077 created.

update everything_items
set project_id = (select id from everything_projects where slug = 'web')
where project_id in (select id from everything_projects where slug = 'requested');

delete from everything_projects where slug = 'requested';
