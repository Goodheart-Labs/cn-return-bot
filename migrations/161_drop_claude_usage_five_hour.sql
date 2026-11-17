-- 161: Anthropic removed the 5-hour window from Claude's plans, and the usage
-- endpoint no longer reports one. The runner on ai-box now stores only the
-- weekly share, so the two 5-hour columns of migration 140 go.

alter table everything_claude_usage
  drop column five_hour,
  drop column five_hour_resets_at;
