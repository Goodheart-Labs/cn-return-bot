-- Checks for migration 204. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  (select relrowsecurity from pg_class where relname = 'pangram_feed_scores') as row_level_security_on,
  not has_table_privilege('anon', 'pangram_feed_scores', 'select') as anon_cannot_read,
  not has_table_privilege('authenticated', 'pangram_feed_scores', 'insert') as authenticated_cannot_write,
  has_table_privilege('service_role', 'pangram_feed_scores', 'insert') as service_role_can_write;
