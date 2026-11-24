-- Checks for migration 203. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  (select relrowsecurity from pg_class where relname = 'x_watch_feed_views') as row_level_security_on,
  not has_table_privilege('anon', 'x_watch_feed_views', 'select') as anon_cannot_read,
  not has_table_privilege('authenticated', 'x_watch_feed_views', 'insert') as authenticated_cannot_write,
  has_table_privilege('service_role', 'x_watch_feed_views', 'insert') as service_role_can_write,
  not has_function_privilege('anon', 'x_watch_best_scores(text, timestamptz)', 'execute') as anon_cannot_call,
  has_function_privilege('service_role', 'x_watch_best_scores(text, timestamptz)', 'execute') as service_role_can_call,
  (select best_scores = '{}' and history_from is null from x_watch_best_scores('wsdm', now() + interval '100 years')) as no_walk_gives_nothing;
