-- 134: admins mark which leaderboard notes they already posted on X (GOO-555).
-- posted_at is when an admin ticked "Posted on X"; null means not posted yet.

alter table everything_best_notes add column posted_at timestamptz;
comment on column everything_best_notes.posted_at is
  'When an admin marked the note as posted on X. Null while it is not posted.';
grant update (posted_at) on everything_best_notes to authenticated;
