-- 069: record which platform a vote was cast from (website vs. browser
-- extension). Votes from before this column stay null — there is no way to
-- backfill where they came from.
alter table everything_votes
  add column platform text check (platform in ('web', 'extension'));
