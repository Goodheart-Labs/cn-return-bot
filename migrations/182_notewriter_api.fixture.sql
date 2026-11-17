-- What migration 182 needs on top of 168_notewriter_protocol.fixture.sql and
-- migration 168: the vote counts of a note.
--
--   (start the database and load the fixture and migration 168 as the top of
--    168_notewriter_protocol.fixture.sql says)
--   $PSQL -f migrations/182_notewriter_api.fixture.sql
--   $PSQL --single-transaction -f migrations/182_notewriter_api.sql
--   $PSQL -f migrations/182_notewriter_api.verify.sql

alter table everything_notes
  add column helpful_count int not null default 0,
  add column somewhat_helpful_count int not null default 0,
  add column not_helpful_count int not null default 0;
