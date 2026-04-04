"""Generate CSV of helpful community notes on short-form video tweets (20-120s)."""

import os
import csv
import glob as globmod
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

# --- Config ---
MIN_DURATION_S = 20
MAX_DURATION_S = 120
MIN_DURATION_MS = MIN_DURATION_S * 1000
MAX_DURATION_MS = MAX_DURATION_S * 1000

CN_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "cn_data")
CN_NOTES_TSVS = sorted(globmod.glob(os.path.join(CN_DATA_DIR, "notes-*.tsv")))
STATUS_HISTORY_TSV = os.path.join(CN_DATA_DIR, "noteStatusHistory-00000.tsv")
OUTPUT_CSV = os.path.join(os.path.dirname(__file__), "video_notes.csv")

# --- Supabase connection ---
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

# --- Load CN public data ---
print("Loading CN notes TSVs...")
notes_cn = pd.concat([pd.read_csv(f, sep="\t", dtype=str) for f in CN_NOTES_TSVS], ignore_index=True)
print(f"  {len(notes_cn)} notes loaded from {len(CN_NOTES_TSVS)} files")

print("Loading status history TSV...")
status_history = pd.read_csv(STATUS_HISTORY_TSV, sep="\t", dtype=str)
print(f"  {len(status_history)} status records loaded")

# --- Filter to helpful notes ---
helpful = status_history[status_history["currentStatus"] == "CURRENTLY_RATED_HELPFUL"]
print(f"  {len(helpful)} helpful notes")

helpful_cn = notes_cn.merge(helpful[["noteId"]], on="noteId", how="inner")
print(f"  {len(helpful_cn)} CN notes matched as helpful")

# Keep only the most recent helpful note per tweet
helpful_cn = helpful_cn.sort_values("createdAtMillis", ascending=True).drop_duplicates(subset="tweetId", keep="first")
print(f"  {len(helpful_cn)} after keeping first helpful note per tweet")

# --- Fetch pipeline_runs from Supabase (paginated) ---
print("Fetching pipeline_runs from Supabase...")
all_runs = []
page_size = 1000
offset = 0
while True:
    resp = (
        supabase.table("pipeline_runs")
        .select("tweet_id, tweet_text, has_video, video_duration_ms")
        .range(offset, offset + page_size - 1)
        .execute()
    )
    all_runs.extend(resp.data)
    if len(resp.data) < page_size:
        break
    offset += page_size

pipeline_runs = pd.DataFrame(all_runs).drop_duplicates(subset="tweet_id")
print(f"  {len(pipeline_runs)} unique pipeline runs fetched")

# --- Join helpful CN notes with pipeline_runs ---
merged = helpful_cn.merge(
    pipeline_runs,
    left_on="tweetId",
    right_on="tweet_id",
    how="inner",
)
print(f"  {len(merged)} notes matched with pipeline runs")

# --- Filter to short-form video content ---
video_notes = merged[
    (merged["has_video"] == True)
    & (merged["video_duration_ms"].notna())
    & (merged["video_duration_ms"].astype(float) >= MIN_DURATION_MS)
    & (merged["video_duration_ms"].astype(float) <= MAX_DURATION_MS)
].copy()
print(f"  {len(video_notes)} notes on short-form video ({MIN_DURATION_S}-{MAX_DURATION_S}s)")

# --- Build output columns ---
video_notes["video_duration"] = (video_notes["video_duration_ms"].astype(float) / 1000).round(1)
video_notes["tweet_link"] = "https://x.com/i/web/status/" + video_notes["tweet_id"]
video_notes["note_link"] = "https://x.com/i/communitynotes/n/" + video_notes["noteId"]
video_notes["tweet_text_len"] = video_notes["tweet_text"].str.len()

# --- Sort by tweet text length ascending ---
video_notes = video_notes.sort_values("tweet_text_len", ascending=True)

# --- Write CSV ---
output = video_notes[["tweet_id", "tweet_text", "summary", "video_duration", "tweet_link", "note_link"]].rename(
    columns={"summary": "note_text"}
)
output.to_csv(OUTPUT_CSV, index=False, quoting=csv.QUOTE_ALL)
print(f"\nOutput: {OUTPUT_CSV}")
print(f"Total rows: {len(output)}")
