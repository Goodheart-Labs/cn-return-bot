"""
Find short-form video tweets from pipeline_runs that have no currently
rated-helpful community note, sorted by recency.

Uses:
  - Supabase `pipeline_runs` for video tweets
  - Local CN data TSVs for note status and content

Usage (from cn-return-bot root):
  python scripts_jim/2026_03_19_video_no_misinfo/video_no_misinfo_pipeline.py
"""

import os
import csv
import json
from datetime import datetime, timedelta, timezone

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

# --- Config ---
MIN_DURATION_S = 20
MAX_DURATION_S = 120
MIN_DURATION_MS = MIN_DURATION_S * 1000
MAX_DURATION_MS = MAX_DURATION_S * 1000
MIN_AGE_HOURS = 96

CN_DATA_DIR = os.path.join("scripts_jim", "cn_data")
STATUS_HISTORY_TSV = os.path.join(CN_DATA_DIR, "noteStatusHistory-00000.tsv")
NOTES_TSVS = sorted(f for f in os.listdir(CN_DATA_DIR) if f.startswith("notes-") and f.endswith(".tsv"))
OUTPUT_CSV = os.path.join("scripts_jim", "2026_03_19_video_no_misinfo", "video_no_misinfo_pipeline.csv")

# --- Supabase connection ---
load_dotenv(".env.local")
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
print("Connected to Supabase")

# --- Fetch pipeline_runs: short-form video tweets ---
print("Fetching video pipeline_runs from Supabase...")
cutoff = (datetime.now(timezone.utc) - timedelta(hours=MIN_AGE_HOURS)).isoformat()
all_runs = []
PAGE_SIZE = 1000
offset = 0
while True:
    resp = (
        supabase.table("pipeline_runs")
        .select("tweet_id, tweet_text, video_duration_ms, tweet_impressions, created_at")
        .eq("has_video", True)
        .gte("video_duration_ms", MIN_DURATION_MS)
        .lte("video_duration_ms", MAX_DURATION_MS)
        .lte("created_at", cutoff)
        .range(offset, offset + PAGE_SIZE - 1)
        .execute()
    )
    all_runs.extend(resp.data)
    if len(resp.data) < PAGE_SIZE:
        break
    offset += PAGE_SIZE

runs = pd.DataFrame(all_runs).drop_duplicates(subset="tweet_id")
print(f"  {len(runs)} unique short-form video tweets ({MIN_DURATION_S}-{MAX_DURATION_S}s, older than {MIN_AGE_HOURS}h)")

# --- Load CN notes (with classification and summary) ---
print("Loading CN notes TSVs...")
notes_cn = pd.concat(
    [
        pd.read_csv(
            os.path.join(CN_DATA_DIR, f), sep="\t", dtype=str,
            usecols=["noteId", "tweetId", "classification", "summary"],
        )
        for f in NOTES_TSVS
    ],
    ignore_index=True,
)
print(f"  {len(notes_cn)} notes loaded")

# --- Load status history ---
print("Loading status history...")
status = pd.read_csv(STATUS_HISTORY_TSV, sep="\t", dtype=str, usecols=["noteId", "currentStatus"])
print(f"  {len(status)} status records")

notes_with_status = notes_cn.merge(status, on="noteId", how="inner")

# --- Find tweets with NO currently-rated-helpful note ---
helpful_tweet_ids = set(
    notes_with_status.loc[notes_with_status["currentStatus"] == "CURRENTLY_RATED_HELPFUL", "tweetId"]
)
# All tweets that have at least one note
noted_tweet_ids = set(notes_with_status["tweetId"])
# Tweets with notes but none currently helpful
no_helpful_tweet_ids = noted_tweet_ids - helpful_tweet_ids
print(f"  {len(helpful_tweet_ids)} tweets have a rated-helpful note")
print(f"  {len(no_helpful_tweet_ids)} tweets have notes but no helpful note")

# --- Filter ---
before = len(runs)
runs = runs[runs["tweet_id"].isin(no_helpful_tweet_ids)]
print(f"  {before} -> {len(runs)} after filtering to tweets with no helpful note")

# --- Build notes column: all notes per tweet as JSON ---
print("Building notes summary per tweet...")
notes_for_output = notes_with_status[notes_with_status["tweetId"].isin(runs["tweet_id"])].copy()


def build_notes_json(group):
    notes_list = []
    for _, row in group.iterrows():
        notes_list.append({
            "classification": row["classification"],
            "status": row["currentStatus"],
            "text": row["summary"],
        })
    return json.dumps(notes_list, ensure_ascii=False)


tweet_notes = notes_for_output.groupby("tweetId").apply(build_notes_json).reset_index()
tweet_notes.columns = ["tweet_id", "notes"]

# --- Sort by recency ---
runs["tweet_impressions"] = pd.to_numeric(runs["tweet_impressions"], errors="coerce")
runs["created_at"] = pd.to_datetime(runs["created_at"])
runs = runs.sort_values("created_at", ascending=False)

# --- Build output ---
runs["video_duration_s"] = (runs["video_duration_ms"].astype(float) / 1000).round(1)
runs["tweet_link"] = "https://x.com/i/web/status/" + runs["tweet_id"]
runs = runs.merge(tweet_notes, on="tweet_id", how="left")

output = runs[[
    "tweet_link", "tweet_text", "tweet_impressions", "video_duration_s", "notes",
]]

output.to_csv(OUTPUT_CSV, index=False, quoting=csv.QUOTE_ALL)
print(f"\nOutput: {OUTPUT_CSV}")
print(f"Total rows: {len(output)}")
print(output.head(10).to_string())
