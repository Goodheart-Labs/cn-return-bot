"""
Cache the "Create Notes Routine" GitHub Actions invocations (our definition of a
routine run) to routine_runs.json.

There is no routine-run ID in the DB: pipeline_runs is one row per tweet. So the
faithful "routine started at" signal is each GitHub Actions invocation's
run_started_at. Runs never overlap (concurrency: cancel-in-progress: false), so
their [run_started_at_i, run_started_at_{i+1}) windows partition time and we can
bin a submitted note to its routine by submitted_at.

Pulls every run since FROM_DATE via the paginated REST API (the gh CLI -L flag
truncates well below the ~5k runs in a 2-month window).
"""
import json
import subprocess
from datetime import date, timedelta
from pathlib import Path

REPO = "Goodheart-Labs/cn-return-bot"
WORKFLOW_FILE = "create-notes-routine-dynamic.yml"
FROM_DATE = date(2026, 5, 1)   # ~2 months back from 2026-07-01
TO_DATE = date(2026, 7, 2)     # exclusive upper bound (today + 1)
CHUNK_DAYS = 7                 # ~96 runs/day * 7 < GitHub's 1000-result cap
HERE = Path(__file__).resolve().parent
OUT = HERE / "routine_runs.json"


def gh_runs_in_window(start: date, end: date) -> list[dict]:
    # GitHub's workflow-runs API hard-caps at 1000 results per query, so we
    # fetch in date-range chunks small enough to stay under the cap, then merge.
    created = f"{start.isoformat()}..{end.isoformat()}"
    cmd = [
        "gh", "api", "--paginate", "--slurp",
        f"/repos/{REPO}/actions/workflows/{WORKFLOW_FILE}/runs"
        f"?created={created}&per_page=100",
    ]
    raw = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    runs = []
    for page in json.loads(raw):
        runs.extend(page.get("workflow_runs", []))
    return runs


def gh_paginate_runs() -> list[dict]:
    runs = []
    cursor = FROM_DATE
    while cursor < TO_DATE:
        window_end = min(cursor + timedelta(days=CHUNK_DAYS - 1), TO_DATE - timedelta(days=1))
        chunk = gh_runs_in_window(cursor, window_end)
        print(f"  {cursor}..{window_end}: {len(chunk)} runs")
        runs.extend(chunk)
        cursor = window_end + timedelta(days=1)
    return runs


def main() -> None:
    runs = gh_paginate_runs()
    slim = [
        {
            "id": r["id"],
            "run_started_at": r.get("run_started_at") or r.get("created_at"),
            "created_at": r["created_at"],
            "status": r["status"],
            "conclusion": r["conclusion"],
            "event": r["event"],
        }
        for r in runs
    ]
    # Dedup by id (paginated APIs can repeat a row across page boundaries) and sort.
    by_id = {r["id"]: r for r in slim}
    ordered = sorted(by_id.values(), key=lambda r: r["run_started_at"])
    OUT.write_text(json.dumps(ordered, indent=2))
    print(f"Wrote {len(ordered)} routine runs to {OUT.name}")
    print(f"  earliest: {ordered[0]['run_started_at']}")
    print(f"  latest:   {ordered[-1]['run_started_at']}")
    events = {}
    for r in ordered:
        events[r["event"]] = events.get(r["event"], 0) + 1
    print(f"  by event: {events}")


if __name__ == "__main__":
    main()
