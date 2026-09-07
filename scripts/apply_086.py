# /// script
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Applies migration 086 to production the safe way, or explains why it will not.

    uv run scripts/apply_086.py pause     # unschedule the dispatch and wait for any run to finish
    uv run scripts/apply_086.py preflight # read-only checks; prints what the migration will do
    uv run scripts/apply_086.py apply     # the migration, in one transaction, then post-checks
    uv run scripts/apply_086.py resume    # reschedule the dispatch (do this AFTER merging the PR)

The order matters. The migration drops two tables the current pipeline reads,
so the dispatch is paused first and only resumed once the new code is on main;
between apply and resume a run would fail. Every step refuses to go on if the
one before it is not in the state it expects.
"""
import os, subprocess, sys, time, urllib.parse
from pathlib import Path
from dotenv import load_dotenv
import psycopg2

REPO = Path(__file__).resolve().parent.parent
JOB = "dispatch-everything-priority-feeds"
WORKFLOW = "everything-priority-feeds.yml"


def connect():
    load_dotenv(REPO / ".env")
    raw = os.environ["PROD_DB_URL"].strip().strip('"').strip("'")
    creds, hostpart = raw.split("://", 1)[1].rsplit("@", 1)
    user, password = creds.split(":", 1)
    hostname, port = hostpart.split("/", 1)[0].split(":")
    return psycopg2.connect(host=hostname, port=int(port), user=user, password=urllib.parse.unquote(password),
                            dbname="postgres", connect_timeout=15)


def runs_in_progress() -> int:
    out = subprocess.run(["gh", "run", "list", f"--workflow={WORKFLOW}", "--status", "in_progress", "--json", "databaseId", "--jq", "length"],
                         capture_output=True, text=True, cwd=REPO)
    return int(out.stdout.strip() or 0)


def pause(conn):
    cur = conn.cursor()
    cur.execute("select count(*) from cron.job where jobname = %s", (JOB,))
    if cur.fetchone()[0] == 0:
        print("dispatch is already unscheduled")
    else:
        cur.execute("select cron.unschedule(jobid) from cron.job where jobname = %s", (JOB,))
        conn.commit()
        print("dispatch unscheduled")
    while (n := runs_in_progress()) > 0:
        print(f"  {n} run(s) still in progress, waiting 30s")
        time.sleep(30)
    print("no run in progress")


def preflight(conn):
    cur = conn.cursor()
    cur.execute("select count(*) from cron.job where jobname = %s", (JOB,))
    if cur.fetchone()[0]:
        sys.exit("STOP: the dispatch is still scheduled; run `pause` first")
    checks = {
        "already applied": "select count(*) from information_schema.columns where table_name='everything_projects' and column_name='feed_url'",
        "feeds sharing a project_slug (must be 0)": "select count(*) from (select 1 from everything_followed_feeds group by project_slug having count(*)>1) x",
        "live manual flags the backfill keeps": "select count(*) from everything_followed_feeds where priority_until > now()",
        "feeds with no project yet (will be created)": "select count(*) from everything_followed_feeds f where not exists (select 1 from everything_projects p where p.slug=f.project_slug)",
        "projects whose slug will be renamed": """
            select string_agg(p.slug || ' -> ' || derived, ', ') from (
              select p.slug, case
                when f.feed_url ~ '^https://(?!www\\.)[\\w-]+\\.substack\\.com/?$' then lower((regexp_match(f.feed_url, '^https://([\\w-]+)\\.substack\\.com'))[1])
                when f.feed_url ~ '^https://www\\.youtube\\.com/@[\\w.-]+/?$' then lower((regexp_match(f.feed_url, '/@([\\w.-]+)/?$'))[1])
                when f.feed_url ~ '^https://www\\.youtube\\.com/channel/[\\w-]+/?$' then lower((regexp_match(f.feed_url, '/channel/([\\w-]+)/?$'))[1])
                when f.feed_url ~ '^https://www\\.(lesswrong\\.com|alignmentforum\\.org)/users/[\\w.-]+/?$' then lower((regexp_match(f.feed_url, '/users/([\\w.-]+)/?$'))[1])
              end as derived
              from everything_projects p join everything_followed_feeds f on f.project_slug = p.slug) p
            where p.derived is distinct from p.slug""",
        "stored feed urls the parser cannot read (must be 0)": """
            select count(*) from everything_followed_feeds f where regexp_replace(f.feed_url,'/+$','') !~ '^https://(?!www\\.)[\\w-]+\\.substack\\.com$'
              and regexp_replace(f.feed_url,'/+$','') !~ '^https://www\\.youtube\\.com/(@[\\w.-]+|channel/[\\w-]+)$'
              and regexp_replace(f.feed_url,'/+$','') !~ '^https://www\\.(lesswrong\\.com|alignmentforum\\.org)/users/[\\w.-]+$'""",
    }
    for label, sql in checks.items():
        cur.execute(sql)
        print(f"  {label}: {cur.fetchone()[0]}")


def apply(conn):
    preflight(conn)
    sql = (REPO / "migrations" / "086_creators.sql").read_text()
    cur = conn.cursor()
    cur.execute(sql)
    conn.commit()
    print("migration 086 applied")
    for label, q in {
        "projects with a feed": "select count(*) from everything_projects where feed_url is not null",
        "of which currently prioritised": "select count(*) from everything_projects where priority_until > now()",
        "views under the old names": "select count(*) from information_schema.views where table_name in ('everything_followed_feeds','everything_follow_requests')",
        "the three renamed": "select string_agg(slug, ', ') from everything_projects where slug in ('thezvi','dwarkeshpatel','astralcodexten')",
    }.items():
        cur.execute(q)
        print(f"  {label}: {cur.fetchone()[0]}")


def resume(conn):
    sql = (REPO / "migrations" / "071_reschedule_everything_dispatch.sql").read_text()
    cur = conn.cursor()
    cur.execute(sql)
    conn.commit()
    cur.execute("select schedule, active from cron.job where jobname = %s", (JOB,))
    print("dispatch rescheduled:", cur.fetchone())


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else ""
    if step not in ("pause", "preflight", "apply", "resume"):
        sys.exit(__doc__)
    conn = connect()
    {"pause": pause, "preflight": preflight, "apply": apply, "resume": resume}[step](conn)
    conn.close()
