# /// script
# dependencies = []
# ///
"""Pulls every source the verifier could not fetch out of the prod run logs.

Method. The source verifier writes the prompt it sent to the model into the run
log under note_writer_steps.source_verifier. Each cited source appears there as
a "### <url>" heading followed by the fetched text, or by "Fetch failed: <reason>"
or "Fetch error: <reason>" when the fetch ladder gave up. This script scans the
last 14 days of pipeline_runs (the X bot) and everything_pipeline_runs (Common
Notes claim checks, kind = check) for those headings, one day per query, because
a single query over two weeks of logs runs past the management API's time limit.

The SQL goes through Supabase's management API with the CLI login token, the
same way scripts/apply_086.py does.

    uv run src/scripts_jim/2026_09_16_unfetchable_sources/01_extract_failures.py
"""
import json, sys, urllib.request
from pathlib import Path

PROJECT_REF = "ugytvkevhsmcpunfvncw"
DAYS = 14
OUT = Path(__file__).parent / "data"
TOKEN = Path.home().joinpath(".supabase/access-token").read_text().strip()

# In the jsonb text a newline is the two characters backslash and n, so the
# pattern escapes them for Postgres.
FAILURE_PATTERN = r"'### (https?://[^\s\"\\\\]+)\\\\n(Fetch failed|Fetch error): ([^\"\\\\]*)'"


def query(sql: str):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "curl/8.5.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read() or b"[]")


def day_sql(table: str, id_cols: str, extra_where: str, day: int) -> str:
    return f"""
    select {id_cols}, created_at, outcome, outcome_reason, g[1] as url, g[2] as kind, g[3] as reason
    from (select {id_cols}, created_at, outcome, outcome_reason,
                 (logs->'note_writer_steps'->'source_verifier')::text as t
          from {table}
          where created_at >= now() - interval '{day + 1} days' and created_at < now() - interval '{day} days'
            and logs ? 'note_writer_steps' {extra_where}) s,
         regexp_matches(t, {FAILURE_PATTERN}, 'g') as g;
    """


def extract(table: str, id_cols: str, extra_where: str, out_name: str):
    rows = []
    for day in range(DAYS):
        rows += query(day_sql(table, id_cols, extra_where, day))
        print(f"{table} day {day}: {len(rows)} rows so far", file=sys.stderr)
    (OUT / out_name).write_text(json.dumps(rows, indent=1))
    print(f"{out_name}: {len(rows)} failures, {len({r['url'] for r in rows})} unique urls")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    extract("pipeline_runs", "id, tweet_id", "", "x_verifier_failures_14d.json")
    extract("everything_pipeline_runs", "id, item_id, claim_id", "and kind = 'check'", "everything_verifier_failures_14d.json")
