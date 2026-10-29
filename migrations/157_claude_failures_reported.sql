-- 157: the feed run turns red for every post the Claude note writer failed on
-- (GOO-618). The runner on ai-box logs each failure as an item_failed event in
-- everything_claude_events. This column says up to which event time a feed
-- run has reported them, so each failure turns exactly one run red. Apply this
-- before the PR is merged, because the feed run reads the column from then on.

alter table everything_feed_schedule
  add column claude_failures_reported_through timestamptz not null default now();

comment on column everything_feed_schedule.claude_failures_reported_through is
  'The time of the newest item_failed event of the Claude note writer that a feed run has reported. Later failures turn the next run red.';

notify pgrst, 'reload schema';
