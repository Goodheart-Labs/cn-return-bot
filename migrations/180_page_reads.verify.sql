-- Checks for migration 180. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  (select relrowsecurity from pg_class where relname = 'page_reads') as row_level_security_on,
  not has_table_privilege('anon', 'page_reads', 'select') as anon_cannot_read,
  not has_table_privilege('authenticated', 'page_reads', 'insert') as authenticated_cannot_write,
  has_table_privilege('service_role', 'page_reads', 'insert') as service_role_can_write;
