-- The daily site checks (GOO-804). One row per nightly run on the services
-- box (ops/cn-site-checks.service, src/site-checks/run.ts). The devbox's CI
-- checker Claude reads the newest report every morning with
-- `bun run site-checks-latest`. `results` holds one entry per check, with its
-- site, name, outcome (passed, failed or cannot_run), whether it needed a
-- second try, and what it saw or why it failed, so a later look can tell
-- since when a check has been failing.
--
-- Only the service role writes and reads it, so the anon and authenticated
-- roles get nothing.
create table site_check_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  passed integer not null,
  failed integer not null,
  cannot_run integer not null,
  report text not null,
  results jsonb not null
);

create index site_check_runs_started_at on site_check_runs (started_at desc);

alter table site_check_runs enable row level security;
revoke all on site_check_runs from anon, authenticated;

notify pgrst, 'reload schema';
