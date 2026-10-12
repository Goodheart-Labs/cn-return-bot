-- Tests migration 115 against a minimal stand-in for the four tables it touches.
-- docker run -d --rm --name cn-m115 -e POSTGRES_PASSWORD=test postgres:17
-- then pipe this file's fixture half, 115_vote_history.sql, then its verify half into
-- docker exec -i cn-m115 psql -v ON_ERROR_STOP=1 -U postgres. Expect 9 history rows
-- (cast, changed, retracted, cast, cascaded, cast, retracted, cast, cascaded) and two
-- "blocked" notices.

-- Fixture (run before the migration)
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create table everything_notes (id uuid primary key);
create table everything_note_not_needed (id uuid primary key);
create table everything_passage_highlights (id uuid primary key);
create table everything_votes (id uuid primary key default gen_random_uuid(), note_id uuid not null references everything_notes(id) on delete cascade, voter_id uuid not null references auth.users(id) on delete cascade, vote smallint not null, reasoning text, updated_at timestamptz default now(), unique (note_id, voter_id));
create table everything_note_not_needed_votes (entry_id uuid not null references everything_note_not_needed(id) on delete cascade, voter_id uuid not null references auth.users(id) on delete cascade, vote smallint not null, primary key (entry_id, voter_id));
create table everything_passage_highlight_votes (entry_id uuid not null references everything_passage_highlights(id) on delete cascade, voter_id uuid not null references auth.users(id) on delete cascade, vote smallint not null, primary key (entry_id, voter_id));
grant all on all tables in schema public to anon, authenticated;

-- Verify (run after the migration)
\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into everything_notes values ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
insert into everything_note_not_needed values ('20000000-0000-0000-0000-000000000001');
insert into everything_passage_highlights values ('30000000-0000-0000-0000-000000000001');
-- 1 cast, 2 no-op update, 3 change, 4 retract
insert into everything_votes (note_id, voter_id, vote) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 1);
update everything_votes set reasoning = 'x', updated_at = now() where voter_id = '00000000-0000-0000-0000-00000000000a';
update everything_votes set vote = -1 where voter_id = '00000000-0000-0000-0000-00000000000a';
delete from everything_votes where voter_id = '00000000-0000-0000-0000-00000000000a';
-- 5 cascade via note delete
insert into everything_votes (note_id, voter_id, vote) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 0);
delete from everything_notes where id = '10000000-0000-0000-0000-000000000002';
-- 6 other tables: cast + retract; cascade via user delete
insert into everything_note_not_needed_votes values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 1);
delete from everything_note_not_needed_votes;
insert into everything_passage_highlight_votes values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', -1);
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select vote_table, right(target_id::text, 1) t, right(voter_id::text, 1) v, action, old_vote, new_vote from everything_vote_history order by id;
-- 7 clients cannot read or write the log
set role anon;
do $$ begin perform 1 from everything_vote_history; raise exception 'anon could read'; exception when insufficient_privilege then raise notice 'anon read blocked'; end $$;
set role authenticated;
do $$ begin insert into everything_vote_history (vote_table, target_id, voter_id, action) values ('everything_votes', gen_random_uuid(), gen_random_uuid(), 'cast'); raise exception 'authenticated could write'; exception when insufficient_privilege then raise notice 'authenticated write blocked'; end $$;
reset role;
