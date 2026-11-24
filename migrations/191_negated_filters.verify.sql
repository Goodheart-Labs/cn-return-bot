-- Checks for migration 190. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  field_query_condition('everything_review_field_row', '[{"column": "creator", "in": ["a"]}]')
    = 'true and f.creator::text = any (''{a}''::text[])' as plain_filter_unchanged,
  field_query_condition('everything_review_field_row', '[{"column": "creator", "in": ["a"], "not": true}]')
    = 'true and not coalesce(true and f.creator::text = any (''{a}''::text[]), false)' as negated_filter_keeps_missing_values,
  field_query_condition('everything_review_field_row', '[{"column": "helpful_votes", "min": 3, "not": true}]')
    = 'true and not coalesce(true and f.helpful_votes::float8 >= 3, false)' as negated_count_filter,
  not has_function_privilege('anon', 'field_query_condition(regclass, jsonb, text)', 'execute') as anon_still_cannot_call;
