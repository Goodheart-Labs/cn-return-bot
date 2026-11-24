-- 187: which notewriter each Claude usage reading and each Claude run belongs
-- to (GOO-787).
--
-- Until now one Claude plan was measured: first Nathan's, on the ai-box, then
-- Jim's main plan, on the devbox. Since 2026-11-19 the ai-box runner runs on
-- Jim's notewriter account, a plan used for nothing else, while Nathan's hq
-- writer runs on his own plan and also writes cost rows. Mixed together, the
-- X share split the notewriter account's usage by costs that included hq's
-- posts, and the pacing would have read a week of Jim's main plan as the new
-- account's. So both tables name the notewriter whose plan they measure, and
-- every reader picks only its own notewriter's rows.
--
-- The column may be null. A runner on code from before this migration, such
-- as hq until it pulls, writes rows without it, and no reader counts those.
--
-- The old rows are filled in from what tells the hosts apart:
-- * Usage readings: the ai-box runner wrote them until it stopped on
--   2026-11-01 05:47 UTC, on Nathan's plan, and the devbox's dispatcher after
--   that, on Jim's main plan. The devbox called itself claude-ai-box until
--   2026-11-19, but its plan is the one claude-devbox names.
-- * Runs: the run folder. /tmp/cn-notes and /var/tmp/cn-notes are the ai-box,
--   /home/jim/.local/share is the devbox's dispatcher, and
--   /home/workspace/streams/nathan is hq.
--
-- UNDO: alter table everything_claude_usage drop column notewriter;
--       alter table everything_claude_runs drop column notewriter;

alter table everything_claude_usage
  add column notewriter text references everything_notewriters (id);
comment on column everything_claude_usage.notewriter is
  'The notewriter whose Claude plan this reading measures. Null for a reading from code that did not say.';

alter table everything_claude_runs
  add column notewriter text references everything_notewriters (id);
comment on column everything_claude_runs.notewriter is
  'The notewriter whose Claude plan paid for the run. Null for a run from code that did not say.';

update everything_claude_usage
set notewriter = case when at < '2026-11-01 05:47:00+00' then 'claude-ai-box' else 'claude-devbox' end;

update everything_claude_runs
set notewriter = case
  when run_dir like '/tmp/cn-notes/%' or run_dir like '/var/tmp/cn-notes/%' then 'claude-ai-box'
  when run_dir like '/home/jim/.local/share/%' then 'claude-devbox'
  when run_dir like '/home/workspace/streams/nathan/%' then 'claude-hq-nathan'
end;

-- The pacing and the dashboard read one notewriter's readings of the last days.
drop index everything_claude_usage_at;
create index everything_claude_usage_notewriter_at on everything_claude_usage (notewriter, at);
