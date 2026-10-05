# Testing migration 114 before it touches production

Migration 114 changes what readers may write to ten tables. It is tested
against a schema-only copy of the production tables. `scripts/schema_fixture.py`
reads that copy from production's catalog with read-only queries. It contains
the real columns, constraints, policies, grants, triggers and functions, but no
rows. `114_client_write_limits.verify.sql` then sends the inserts the website
and the extension send, as the roles PostgREST uses.

```bash
uv run scripts/schema_fixture.py /tmp/fixture_114.sql \
  everything_projects everything_items everything_claims everything_notes \
  everything_note_not_needed everything_note_not_needed_votes everything_votes \
  everything_donations everything_passage_highlights everything_passage_highlight_votes \
  everything_passage_questions everything_note_requests everything_link_visits \
  everything_events everything_pipeline_runs

sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
until sudo docker exec cn-migration-test pg_isready -U postgres; do sleep 1; done

export PGPASSWORD=test
PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f /tmp/fixture_114.sql
$PSQL --single-transaction -f migrations/114_client_write_limits.sql
psql -h 127.0.0.1 -p 55432 -U postgres -q -f migrations/114_client_write_limits.verify.sql

sudo docker stop cn-migration-test
```

The verify script always ends with an error named `RESULT`, which rolls back
everything it wrote. Every value in that result should be true. It checks that:

1. The extension's item insert still works. An item cannot be inserted with a
   priority, a body text or a status other than done, or with an address that
   is not http(s).
2. A claim and a note inserted the way the write-a-note flow does still work.
   A claim cannot carry images, and a note cannot carry vote counts or more
   than 2,000 characters.
3. A signed note, not-needed entry or key point carries the account's X
   handle, whatever name the client sent. An email account's name is the part
   of its address before the @. An unsigned note stays unsigned.
4. A visit's time is the time of the insert. The 1,001st visit in an hour is
   refused, and so is a single batch that would cross the ceiling.
5. Inserts made with the service key are never limited, and a pipeline claim
   may still hold a whole article.
6. The 101st note request in a day is refused.
7. A press grants at most seven days, even when the helper is called directly.
8. The reader-cost sum counts passage questions and leaves feed checks out.
9. A vote's donation is saved and re-priced through the client's upsert, and
   its charity can be changed. An amount above 13 USD, or a write to the
   payout amount, is refused.

The fixture is not checked in. It is regenerated from production each time, so
it always matches what the migration will meet.
