\set ON_ERROR_STOP on
\pset pager off

\echo '--- 0. the extension can write the heartbeat as anon, and still cannot read anything back'
-- d1 sends two on 2026-09-01 (a worker that booted twice), d2 one, and d3
-- one stamped 01:00 in Berlin, which is 23:00 UTC on the 1st and must land
-- there. d1 sends again on the 2nd.
set role anon;
insert into everything_events (event, platform, device_id, created_at) values
  ('extension_active', 'extension', '00000000-0000-0000-0000-0000000000d1', '2026-09-01 08:00+00'),
  ('extension_active', 'extension', '00000000-0000-0000-0000-0000000000d1', '2026-09-01 20:00+00'),
  ('extension_active', 'extension', '00000000-0000-0000-0000-0000000000d2', '2026-09-01 09:00+00'),
  ('extension_active', 'extension', '00000000-0000-0000-0000-0000000000d3', '2026-09-02 01:00+02'),
  ('extension_active', 'extension', '00000000-0000-0000-0000-0000000000d1', '2026-09-02 08:00+00');
\set ON_ERROR_STOP off
select count(*) from everything_events;
\set ON_ERROR_STOP on
reset role;

\echo '--- 1. an event name outside the whitelist is still refused'
\set ON_ERROR_STOP off
insert into everything_events (event, platform, device_id) values ('extension_bogus', 'extension', '00000000-0000-0000-0000-0000000000d1');
\set ON_ERROR_STOP on

\echo '--- 2. the pipeline days, read as anon'
\echo '    expected 08-01: items 1, extracted 1, checked 1, tallies [(2,1,0) x1]'
\echo '             09-05: items 2 (the errored post is not one; the paragraph check finished 01:00 Berlin on the 6th,'
\echo '                    which is the 5th in UTC), extracted 6 (the reader claim is not one), checked 5 (the skipped'
\echo '                    claim is not one), tallies [(2,0,0) x1, (2,1,0) x1] (the hidden AI note is absent)'
\echo '             09-06: all zero and an empty tally list'
set role anon;
select * from everything_pipeline_daily() where day in ('2026-08-01', '2026-09-05', '2026-09-06') order by day;

\echo '--- 3. the days between are present with zeros and an empty tally list, and the series ends today'
select count(*) as zero_days from everything_pipeline_daily() where items_processed = 0 and ai_note_tallies = '[]'::jsonb;
select max(day) = (now() at time zone 'utc')::date as ends_today, min(day) = '2026-08-01' as starts_at_first_post from everything_pipeline_daily();

\echo '--- 4. the daily series on the three active days'
\echo '    expected 09-01: devices 3, viewers {"1":1,"3":1}, seen 12, voters {"2":1}, votes 2, writers {"1":1}, written 1'
\echo '             09-02: devices 1, viewers {"3":1}, seen 3, voters {"1":1,"3":1}, votes 4, writers {"1":2}, written 2'
\echo '             09-08: devices 0, viewers {"20":1}, seen 21, voters {"1":1}, votes 1, writers {}, written 0'
select * from everything_metric_series('day') where bucket in ('2026-09-01', '2026-09-02', '2026-09-08') order by bucket;

\echo '--- 5. before a source began recording its columns are null, after that they are 0'
\echo '    expected 08-19: no row at all, the series starts with the first event on 08-20'
\echo '             08-20: viewers {} and seen 0, everything else null'
\echo '             08-25: writers {} and written 0 join in'
\echo '             08-31: devices and voters still null'
select * from everything_metric_series('day') where bucket in ('2026-08-19', '2026-08-20', '2026-08-25', '2026-08-31') order by bucket;

\echo '--- 6. weeks start on Monday'
\echo '    expected 08-31: devices 3, viewers {"1":1,"3":2}, seen 15, voters {"1":1,"2":1,"3":1}, votes 6, writers {"1":1,"2":1}, written 3'
\echo '             09-07: devices 0, viewers {"20":1}, seen 21, voters {"1":1}, votes 1, writers {}, written 0'
select * from everything_metric_series('week') where bucket in ('2026-08-31', '2026-09-07') order by bucket;

\echo '--- 7. the month'
\echo '    expected 09-01: devices 3, viewers {"3":2,"20":1}, seen 36, voters {"2":2,"3":1}, votes 7, writers {"1":1,"2":1}, written 3'
select * from everything_metric_series('month') where bucket = '2026-09-01';

\echo '--- 8. the series runs through to today without gaps'
select count(*) = (current_date - '2026-08-20'::date + 1) as no_gaps from everything_metric_series('day');

\echo '--- 9. an unknown granularity is refused'
\set ON_ERROR_STOP off
select * from everything_metric_series('hour');
\set ON_ERROR_STOP on

\echo '--- 10. anon still cannot read the raw rows'
\set ON_ERROR_STOP off
select count(*) from everything_events;
select count(*) from everything_votes;
\set ON_ERROR_STOP on
reset role;
