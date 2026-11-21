-- Checks for migration 195. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  (select relrowsecurity from pg_class where relname = 'feed_view_posts') as row_level_security_on,
  not has_table_privilege('anon', 'feed_view_posts', 'select') as anon_cannot_read,
  not has_table_privilege('authenticated', 'feed_view_posts', 'insert') as authenticated_cannot_write,
  has_table_privilege('service_role', 'feed_view_posts', 'insert') as service_role_can_write;
