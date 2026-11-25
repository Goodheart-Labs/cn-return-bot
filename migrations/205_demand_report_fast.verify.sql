-- Checks for migration 205. Run it after the migration. It changes nothing.
-- Every value should be true, and the whole file should take about a second.
select
  not has_function_privilege('anon', 'everything_demand_report()', 'execute') as anon_cannot_report,
  has_function_privilege('service_role', 'everything_demand_report()', 'execute') as service_role_can_report,
  -- The counts the daily cap reads agree with the log itself.
  not exists (
    select 1 from everything_demand_report() r
     where r.queued_24h <> (select count(*) from everything_demand_queued q
                             where q.queued and q.kind = r.kind and q.queued_at > now() - interval '24 hours')
        or r.settled <> (select count(*) from everything_demand_queued q
                          where q.queued and q.kind = r.kind and q.queued_at > now() - interval '9 days'
                            and q.queued_at <= now() - interval '2 days')
        or r.checked > r.settled or r.with_notes > r.checked
  ) as report_agrees_with_the_log;
