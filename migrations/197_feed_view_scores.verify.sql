-- Checks for migration 197. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  exists (select 1 from information_schema.columns
    where table_name = 'feed_tweet_views' and column_name = 'views_to_come' and data_type = 'real') as score_column_exists,
  not has_table_privilege('anon', 'feed_tweet_views', 'select') as anon_still_cannot_read;
