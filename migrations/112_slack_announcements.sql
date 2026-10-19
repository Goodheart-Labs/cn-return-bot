-- 112: what the cn-notify service needs to announce notes in Slack (GOO-228).
--
-- The service checks the database once a minute. It posts to four channels:
-- a new note on one of a few handpicked creators, a note written by a person,
-- a note's first Helpful vote, and a note becoming rated helpful. Each check
-- looks at the last day of activity, so the same event comes up again on the
-- next check. This table remembers what was already posted, so each event is
-- announced exactly once.

create table everything_slack_announcements (
  channel text not null
    check (channel in ('on_important_creator', 'written_by_human', 'first_helpful_vote', 'helpful')),
  subject_id uuid not null,
  posted_at timestamptz not null default now(),
  primary key (channel, subject_id)
);

comment on table everything_slack_announcements is
  'One row per Slack message the cn-notify service posted, so it never posts the same event twice (GOO-228). Service key only.';
comment on column everything_slack_announcements.channel is
  'Which of the four Slack channels the message went to.';
comment on column everything_slack_announcements.subject_id is
  'What the message was about. In on_important_creator it is the everything_items id of a post whose AI notes were announced together, or the everything_notes id of a note a person wrote. In the other three channels it is always an everything_notes id.';

-- No policies: only the service key, which bypasses row level security, can
-- read or write the table.
alter table everything_slack_announcements enable row level security;

-- A vote row is updated in place when a voter changes their mind, and its
-- created_at keeps the time of the first vote. So a vote changed from Not
-- helpful to Helpful would look old. This column records the last time the
-- vote's value changed. Existing rows get their creation time, so the first
-- check after this migration does not mistake every old vote for a new one.
alter table everything_votes add column updated_at timestamptz;
update everything_votes set updated_at = created_at;
alter table everything_votes alter column updated_at set default now();
alter table everything_votes alter column updated_at set not null;

comment on column everything_votes.updated_at is
  'When the vote was cast or last changed to a different value. The cn-notify service finds new votes by it.';

create function everything_touch_vote()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.vote is distinct from old.vote then
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger everything_votes_touch
  before update on everything_votes
  for each row execute function everything_touch_vote();

create index everything_votes_updated_at_idx on everything_votes (updated_at);

-- The service asks for the notes written in the last day, once a minute. This
-- keeps that a short index read instead of a scan of every note.
create index everything_notes_created_at_idx on everything_notes (created_at);
