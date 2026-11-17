-- 165: the feed run tells the Claude notes Slack channel when the Claude note
-- writer stops reporting the usage of its Claude plan, and again when it
-- reports again (GOO-695). This column holds the time of the newest usage
-- reading when the warning went out. Every later run of the same outage sees
-- the same newest reading and posts nothing. The column is null while no
-- warning is outstanding. Apply this before the PR is merged, because the feed
-- run reads the column from then on.

alter table everything_feed_schedule
  add column claude_silence_warned_for timestamptz;

comment on column everything_feed_schedule.claude_silence_warned_for is
  'The time of the newest Claude usage reading when a feed run warned in Slack that the Claude note writer is silent. Null while no warning is outstanding.';

notify pgrst, 'reload schema';
