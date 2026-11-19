-- Checks for migration 187. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  (select relrowsecurity from pg_class where relname = 'site_check_runs') as row_level_security_on,
  not has_table_privilege('anon', 'site_check_runs', 'select') as anon_cannot_read,
  not has_table_privilege('authenticated', 'site_check_runs', 'insert') as authenticated_cannot_write,
  has_table_privilege('service_role', 'site_check_runs', 'insert') as service_role_can_write;
