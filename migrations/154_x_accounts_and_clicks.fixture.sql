-- A miniature of production for migration 154: migration 153's miniature with
-- 153 applied, a project whose handle Nathan checked, and the events table
-- with production's whitelist, which lacks extension_store_clicked.
--
--   sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
--   PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"   (with PGPASSWORD=test)
--   $PSQL -f migrations/154_x_accounts_and_clicks.fixture.sql
--   $PSQL --single-transaction -f migrations/154_x_accounts_and_clicks.sql
--   $PSQL -f migrations/154_x_accounts_and_clicks.verify.sql
\ir 153_review_fields.fixture.sql
\ir 153_review_fields.sql

insert into everything_projects (id, name, slug) values ('00000000-0000-0000-0000-0000000000f3', 'Zvi', 'thezvi');

create table everything_events (
  id bigint generated always as identity primary key,
  event text not null,
  platform text not null,
  device_id text not null,
  user_id uuid,
  props jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint everything_events_event_check check (event in (
    'pageview', 'notes_shown', 'extension_installed', 'extension_active', 'sign_in_started', 'signed_in',
    'vote_gated_login', 'write_note_teaser_shown', 'improvement_write_rejected', 'note_write_rejected'))
);
