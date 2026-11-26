-- Checks for migration 206. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  position('claude-ai-box' in pg_get_functiondef('everything_claude_publish'::regproc)) = 0 as publish_falls_back_to_devbox,
  not exists (select 1 from everything_claude_usage where notewriter = 'claude-ai-box' and at >= '2026-11-19 09:03:00+00') as usage_has_one_name,
  not exists (select 1 from everything_claude_runs where notewriter = 'claude-ai-box' and started_at >= '2026-11-19 09:03:00+00') as runs_have_one_name,
  (select disabled_at is not null from everything_notewriters where id = 'claude-ai-box') as ai_box_switched_off,
  (select disabled_at is null from everything_notewriters where id = 'claude-devbox') as devbox_on;
