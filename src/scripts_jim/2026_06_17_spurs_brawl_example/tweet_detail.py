"""Dump full detail for the exact tweet the user's competing note is on.

tweet_id 2065534504488591419, competing note 2065574555490431039
(CURRENTLY_RATED_HELPFUL). Pull tweet text + quoted tweet + the Gemini media
description (from the pipeline_run user message in logs).

Run: uv run src/scripts_jim/2026_06_17_spurs_brawl_example/tweet_detail.py
"""

import json
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[2]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

TWEET_ID = "2065534504488591419"

tw = (
    sb.table("tweets")
    .select("tweet_id, text, author_name, referenced_tweets, referenced_tweet_data, media, has_video, has_photo")
    .eq("tweet_id", TWEET_ID)
    .execute()
    .data
)
print("===== TWEET ROW =====")
print(json.dumps(tw, indent=2, default=str))

runs = (
    sb.table("pipeline_runs")
    .select("id, bot_name, outcome, note_text, created_at, logs")
    .eq("tweet_id", TWEET_ID)
    .order("created_at", desc=True)
    .execute()
    .data
)
print(f"\n===== {len(runs)} pipeline_runs =====")
for run in runs:
    print(f"\n--- run {run['id']} bot={run['bot_name']} outcome={run['outcome']} created={run['created_at']} ---")
    print(f"note_text: {run.get('note_text')!r}")
    blob = json.dumps(run.get("logs") or {}, default=str)
    # Find the user message section that renders the media description.
    for marker in ("Media on post", "Media on quoted", "Description:"):
        for m in re.finditer(re.escape(marker), blob):
            start = m.start()
            print(f"\n  [logs excerpt @ {marker!r}]")
            print("  " + blob[start: start + 1200].replace("\\n", "\n  "))
            break
