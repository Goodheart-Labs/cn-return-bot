# Testing migration 086 before it touches production

The migration rewrites how creators are stored and drops two tables, so it is
worth running against a throwaway database first. `086_creators.fixture.sql`
builds a miniature of production, `086_creators.verify.sql` exercises the
result, including the exact queries an extension build from before this change
sends.

```bash
sudo docker run -d --rm --name cn-migration-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:15
until sudo docker exec cn-migration-test pg_isready -U postgres; do sleep 1; done

export PGPASSWORD=test
PSQL="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f migrations/086_creators.fixture.sql
$PSQL --single-transaction -f migrations/086_creators.sql
psql -h 127.0.0.1 -p 55432 -U postgres -q -f migrations/086_creators.verify.sql

sudo docker stop cn-migration-test
```

What the checks prove, in the order they run:

1. Every slug becomes the one its URL derives to: `zvi` is renamed `thezvi`,
   `dwarkesh` becomes `dwarkeshpatel`, `acx` becomes `astralcodexten`. The rows
   keep their ids, which the check proves by showing an item ingested under the
   old slug still hanging off the renamed project. This rename is why the
   backfill joins on the old slug before the old table is dropped: the join is
   what attaches each feed to the right project, and it is irreversible once
   that table is gone.
2. A priority someone set deliberately is kept rather than overwritten by the
   date derived from when the creator was first requested.
3. Creators requested long ago arrive expired; recent ones keep their window.
4. An extension build from **before** this change can still read which creators
   we are checking, through the compatibility view.
5. That same old build's press still works. The insert it sends is redirected
   into a seven-day grant.
6. A current build's press works.
7. A client cannot choose its own window.
8. A client cannot name a project, and a second creator who shares a handle
   with one we know gets a suffixed slug rather than being merged into them.
9. Pressing again extends the window instead of duplicating the creator, and
   never shortens a longer window the pipeline set.
10. A client cannot update or delete.
11. A feed URL the parser cannot read is refused rather than stored.
12. The analytics dashboard's function still runs after the tables it used to
    join are gone.
13. Both old tables are now views.

The fixture and the checks can be deleted once the compatibility views are
dropped and nobody is running an extension from before this change.

# Applying it to production

`scripts/apply_086.py` does it in four steps, each refusing to run unless the
one before left things as expected. The order matters because the migration
drops two tables the current pipeline reads: the dispatch is paused first and
resumed only once the new code is on main, and a run between apply and resume
would fail.

```bash
uv run scripts/apply_086.py pause      # unschedule the pg_cron dispatch, wait for any run to finish
uv run scripts/apply_086.py preflight  # read-only; prints what will be renamed and created
uv run scripts/apply_086.py apply      # one transaction, then post-checks
gh pr merge 441 --merge                # the new code reaches main
uv run scripts/apply_086.py resume     # reschedule the dispatch
gh workflow run everything-priority-feeds.yml && gh run watch   # read the first run's log end to end
```

It needs `PROD_DB_URL` in `.env` to authenticate. The password may contain
characters a URL would need escaped; the script splits the URL by hand for
that reason, so paste the password in as it is.
