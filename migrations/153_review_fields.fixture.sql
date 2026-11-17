-- A miniature of production for migration 153: migration 152's miniature with
-- 152 applied, the columns and tables 153 reads that the earlier fixtures leave
-- out, two leaderboard notes of which one was posted on X, and a second
-- creator whose post nobody saw, with a passage that needed no note.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/153_review_fields.fixture.sql
--   $PSQL --single-transaction -f migrations/153_review_fields.sql
--   $PSQL -f migrations/153_review_fields.verify.sql
\ir 152_drop_approval_setting.fixture.sql
\ir 152_drop_approval_setting.sql

alter table everything_items add column published_at date, add column published_time timestamptz;
alter table everything_best_notes add column posted_at timestamptz;
create table everything_note_recommendations (
  note_id uuid, position float8, comment text, moved_at timestamptz, removed_at timestamptz, removed_reason text
);
update everything_items set published_time = now() - interval '2 days';

insert into everything_best_notes (note_id, position, posted_at)
select note_id, 1, now() - interval '1 day' from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d4';
insert into everything_best_notes (note_id, position)
select note_id, 2 from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d2';

insert into everything_projects (id, name, slug) values ('00000000-0000-0000-0000-0000000000f2', 'Other Creator', 'other-creator');
insert into everything_items (id, project_id, url, title, published_at)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f2', 'https://other.example/p/post', 'Other post', current_date - 70);
insert into everything_claude_drafts (id, item_id, passage, claim, kind, outcome, reasoning, status, created_at)
values ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000e2', 'Fine passage', 'c', 'small_mistake', 'no_note_needed', 'Nothing wrong', 'not_a_note', now() - interval '30 seconds');
