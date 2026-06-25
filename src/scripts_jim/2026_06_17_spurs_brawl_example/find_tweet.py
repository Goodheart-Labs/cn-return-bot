"""Find the tweet for the 'Spurs in 7' brawl competing note.

The user wants this helpful competing note added as a writer few-shot example:
  "The 17-year-old victim, a Knicks fan, was beaten by a Spurs fan yelling
   'Spurs in 7,' not Knicks fans beating a Spurs fan as claimed."

We need the corresponding tweet (text, quoted tweet, media description) to
build the example. Search competing_notes -> tweet_id -> tweets + the latest
pipeline_run logs (for the Gemini media description).

Run: uv run src/scripts_jim/2026_06_17_spurs_brawl_example/find_tweet.py
"""

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[2]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


def search_competing(pattern):
    return (
        sb.table("competing_notes")
        .select("tweet_id, note_id, note_text, current_status, our_note_id, pipeline_run_id")
        .ilike("note_text", pattern)
        .execute()
        .data
    )


hits = []
for pat in ("%Spurs in 7%", "%Knicks fan%", "%beaten by a Spurs%", "%17-year-old%Knicks%"):
    rows = search_competing(pat)
    print(f"competing_notes ilike {pat!r}: {len(rows)} rows")
    hits.extend(rows)

# dedupe by note_id
seen = {}
for r in hits:
    seen[r["note_id"]] = r
hits = list(seen.values())

for r in hits:
    print("\n=== competing note ===")
    print(json.dumps(r, indent=2, default=str))

if not hits:
    print("\nNo competing_notes match. Trying pipeline_runs.note_text ...")
    for pat in ("%Spurs in 7%", "%Knicks fan%"):
        runs = (
            sb.table("pipeline_runs")
            .select("id, tweet_id, note_text, outcome, bot_name")
            .ilike("note_text", pat)
            .execute()
            .data
        )
        print(f"pipeline_runs ilike {pat!r}: {len(runs)} rows")
        for r in runs:
            print(json.dumps(r, indent=2, default=str))

# For each tweet, dump the tweet row + a pipeline_run's user message (media desc).
tweet_ids = {r["tweet_id"] for r in hits if r.get("tweet_id")}
for tid in tweet_ids:
    print(f"\n\n######## TWEET {tid} ########")
    tw = sb.table("tweets").select(
        "tweet_id, text, author_name, referenced_tweets, referenced_tweet_data, media, has_video, has_photo"
    ).eq("tweet_id", tid).execute().data
    print(json.dumps(tw, indent=2, default=str))

    runs = (
        sb.table("pipeline_runs")
        .select("id, bot_name, outcome, note_text, created_at, logs")
        .eq("tweet_id", tid)
        .order("created_at", desc=True)
        .limit(5)
        .execute()
        .data
    )
    for run in runs:
        logs = run.get("logs") or {}
        # The user message is usually stored in logs; dump any string field that
        # mentions "Media on post" / "Description:".
        blob = json.dumps(logs, default=str)
        print(f"\n--- run {run['id']} bot={run['bot_name']} outcome={run['outcome']} ---")
        idx = blob.find("Media on post")
        if idx == -1:
            idx = blob.find("Description:")
        if idx != -1:
            print("...logs excerpt around media description...")
            print(blob[max(0, idx - 200): idx + 1500])
        else:
            print("(no 'Media on post' / 'Description:' substring in logs)")
