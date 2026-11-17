-- A miniature of production for migration 143: the miniature of migration
-- 130 with 130 applied, the columns and tables 143 reads that 130's fixture
-- leaves out, and drafts as production has them before 143: a rejected one,
-- one approved with the old button, one Jim voted Not helpful on, one nobody
-- reviewed and two waiting for approval.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/143_review_by_vote.fixture.sql
--   $PSQL --single-transaction -f migrations/143_review_by_vote.sql
--   $PSQL -f migrations/143_review_by_vote.verify.sql
\ir 130_admin_note_review.fixture.sql
\ir 130_admin_note_review.sql

alter table everything_votes
  add column reasoning text,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();
alter table everything_notes
  add column somewhat_helpful_count int not null default 0,
  add column not_helpful_count int not null default 0,
  add column p_helpful float8;
create function everything_note_status(p_helpful float8) returns text
language sql immutable parallel safe as $$
  select case when p_helpful >= 0.78 then 'helpful' when p_helpful <= 0.2 then 'not_helpful' else 'needs_ratings' end;
$$;
create table everything_best_notes (
  note_id uuid primary key references everything_notes (id) on delete cascade,
  position double precision not null,
  comment text,
  added_at timestamptz not null default now()
);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000a', 'jimmaar1@gmail.com', now()),
  ('00000000-0000-0000-0000-00000000000b', 'nathan@goodheartlabs.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'reader@example.com', now());
insert into everything_projects (id, name, slug) values ('00000000-0000-0000-0000-0000000000f1', 'Some Creator', 'some-creator');
insert into everything_items (id, project_id, url, title) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'https://example.substack.com/p/post', 'A post');

insert into everything_claude_drafts (id, item_id, passage, claim, kind, outcome, note, reasoning, status, created_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'Rejected passage', 'c', 'small_mistake', 'note', 'Rejected text', 'r', 'awaiting_approval', now() - interval '6 minutes'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', 'Approved passage', 'c', 'small_mistake', 'note', 'Approved text', 'r', 'awaiting_approval', now() - interval '5 minutes'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000e1', 'Downvoted passage', 'c', 'small_mistake', 'note', 'Downvoted text', 'r', 'awaiting_approval', now() - interval '4 minutes'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000e1', 'Open passage', 'c', 'small_mistake', 'note', 'Open text', 'r', 'awaiting_approval', now() - interval '3 minutes'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000e1', 'Waiting passage', 'c', 'small_mistake', 'note', 'Waiting text', 'r', 'awaiting_approval', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000e1', 'Second waiting passage', 'c', 'small_mistake', 'note', 'Second waiting text', 'r', 'awaiting_approval', now() - interval '1 minute');

-- The Claude session posts four of them, and the old buttons review two.
select everything_claude_publish(id, 'ai', 'claude') from everything_claude_drafts
 where id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d4');
select set_config('request.jwt.claims', '{"role": "service_role"}', false);
select everything_claude_reject('00000000-0000-0000-0000-0000000000d1', 'Misses the point', 'jim');
update everything_claude_drafts set reviewed_by = 'nathan', reviewed_at = now() where id = '00000000-0000-0000-0000-0000000000d2';
select set_config('request.jwt.claims', '', false);
insert into everything_votes (note_id, voter_id, vote)
select note_id, '00000000-0000-0000-0000-00000000000a', -1 from everything_claude_drafts where id = '00000000-0000-0000-0000-0000000000d3';
