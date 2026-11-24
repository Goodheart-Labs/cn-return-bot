-- Checks for migration 193. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  (select relrowsecurity from pg_class where relname = 'feed_tweet_views') as views_row_level_security_on,
  (select relrowsecurity from pg_class where relname = 'feed_view_walks') as walks_row_level_security_on,
  not has_table_privilege('anon', 'feed_tweet_views', 'select') as anon_cannot_read_views,
  not has_table_privilege('anon', 'feed_view_walks', 'select') as anon_cannot_read_walks,
  not has_table_privilege('authenticated', 'feed_tweet_views', 'insert') as authenticated_cannot_write_views,
  has_table_privilege('service_role', 'feed_tweet_views', 'insert') as service_role_can_write_views,
  has_table_privilege('service_role', 'feed_view_walks', 'insert') as service_role_can_write_walks,
  exists (select 1 from pg_indexes where indexname = 'feed_tweet_views_observed_at' and indexdef like '%brin%') as brin_index_exists;
