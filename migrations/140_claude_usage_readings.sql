-- 140: readings of the Claude plan the note writer runs on (GOO-580).
-- The runner on Nathan's ai-box reads the plan's usage every 10 minutes and
-- stores each reading here. The admin dashboard draws the weekly share over
-- time, so admins see it climb during the week and drop at each reset.

create table everything_claude_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  weekly real not null,
  five_hour real,
  weekly_resets_at timestamptz,
  five_hour_resets_at timestamptz
);
comment on table everything_claude_usage is
  'One reading of the usage of the Claude plan the note writer runs on, in percent of its limits.';
comment on column everything_claude_usage.weekly is 'Percent of the weekly limit used at the time of the reading.';
comment on column everything_claude_usage.five_hour is 'Percent of the rolling 5-hour window used. Null in readings copied from logs that did not keep it.';

create index everything_claude_usage_at on everything_claude_usage (at);

alter table everything_claude_usage enable row level security;
grant all on everything_claude_usage to service_role;
create policy claude_usage_admin_read on everything_claude_usage for select to authenticated
  using (everything_is_admin());
grant select on everything_claude_usage to authenticated;
