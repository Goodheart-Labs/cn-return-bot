"""Generate CSV of video tweets (20-120s) where the community consensus is 'no misinformation'.

A tweet qualifies if either:
  1. The top-agreed note classifies NOT_MISLEADING with agree > disagree, OR
  2. The top-agreed note classifies MISINFORMED_OR_POTENTIALLY_MISLEADING but has
     status CURRENTLY_RATED_NOT_HELPFUL (community rejected the correction).

Uses agree/disagree ratings from CN public ratings data.
"""

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
RATINGS_CHUNK_SIZE = 5_000_000

CN_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "cn_data")
CN_NOTES_TSVS = sorted(globmod.glob(os.path.join(CN_DATA_DIR, "notes-*.tsv")))
CN_RATINGS_TSVS = sorted(globmod.glob(os.path.join(CN_DATA_DIR, "ratings-*.tsv")))
STATUS_HISTORY_TSV = os.path.join(CN_DATA_DIR, "noteStatusHistory-00000.tsv")
OUTPUT_CSV = os.path.join(os.path.dirname(__file__), "video_no_misinfo.csv")

# --- Supabase connection ---
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

# --- Load CN notes ---
print("Loading CN notes TSVs...")
notes_cn = pd.concat(
    [pd.read_csv(f, sep="\t", dtype=str, usecols=["noteId", "tweetId", "classification", "summary"])
     for f in CN_NOTES_TSVS],
    ignore_index=True,
)
print(f"  {len(notes_cn)} notes loaded from {len(CN_NOTES_TSVS)} files")

# --- Load status history ---
print("Loading status history TSV...")
status_history = pd.read_csv(STATUS_HISTORY_TSV, sep="\t", dtype=str, usecols=["noteId", "currentStatus"])
print(f"  {len(status_history)} status records loaded")

# --- Aggregate agree/disagree from ratings (chunked for ~37GB) ---
print(f"Aggregating ratings from {len(CN_RATINGS_TSVS)} files...")
agree_totals = pd.Series(dtype="int64")
disagree_totals = pd.Series(dtype="int64")

for ratings_file in CN_RATINGS_TSVS:
    print(f"  Processing {os.path.basename(ratings_file)}...")
    for chunk in pd.read_csv(
        ratings_file,
        sep="\t",
        dtype={"noteId": str, "agree": "Int8", "disagree": "Int8"},
        usecols=["noteId", "agree", "disagree"],
        chunksize=RATINGS_CHUNK_SIZE,
    ):
        chunk_agree = chunk.groupby("noteId")["agree"].sum()
        chunk_disagree = chunk.groupby("noteId")["disagree"].sum()
        agree_totals = agree_totals.add(chunk_agree, fill_value=0)
        disagree_totals = disagree_totals.add(chunk_disagree, fill_value=0)

rating_counts = pd.DataFrame({"agree": agree_totals.astype(int), "disagree": disagree_totals.astype(int)})
rating_counts.index.name = "noteId"
rating_counts = rating_counts.reset_index()
print(f"  {len(rating_counts)} notes with ratings")

# --- Join notes with ratings and status ---
notes_with_ratings = notes_cn.merge(rating_counts, on="noteId", how="inner")
notes_with_ratings = notes_with_ratings.merge(status_history, on="noteId", how="left")
print(f"  {len(notes_with_ratings)} notes matched with ratings")

# --- Pick highest-agreed note per tweet ---
top_notes = notes_with_ratings.sort_values("agree", ascending=False).drop_duplicates(
    subset="tweetId", keep="first"
)
print(f"  {len(top_notes)} unique tweets after keeping top note per tweet")

# --- Filter: tweet qualifies as "no misinformation" ---
is_not_misleading = (
    (top_notes["classification"] == "NOT_MISLEADING")
    & (top_notes["agree"] > top_notes["disagree"])
)
is_rejected_correction = (
    (top_notes["classification"] == "MISINFORMED_OR_POTENTIALLY_MISLEADING")
    & (top_notes["currentStatus"] == "CURRENTLY_RATED_NOT_HELPFUL")
)
no_misinfo = top_notes[is_not_misleading | is_rejected_correction].copy()

count_nm = is_not_misleading.sum()
count_rc = is_rejected_correction.sum()
print(f"  {len(no_misinfo)} tweets with no misinformation ({count_nm} NOT_MISLEADING, {count_rc} rejected corrections)")

# --- Fetch pipeline_runs from Supabase (paginated) ---
print("Fetching pipeline_runs from Supabase...")
all_runs = []
PAGE_SIZE = 1000
offset = 0
while True:
    resp = (
        supabase.table("pipeline_runs")
        .select("tweet_id, tweet_text, has_video, video_duration_ms")
        .range(offset, offset + PAGE_SIZE - 1)
        .execute()
    )
    all_runs.extend(resp.data)
    if len(resp.data) < PAGE_SIZE:
        break
    offset += PAGE_SIZE

pipeline_runs = pd.DataFrame(all_runs).drop_duplicates(subset="tweet_id")
print(f"  {len(pipeline_runs)} unique pipeline runs fetched")

# --- Join with pipeline_runs ---
merged = no_misinfo.merge(
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

# --- Sort by agree count descending ---
video_notes = video_notes.sort_values("agree", ascending=False)

# --- Write CSV ---
video_notes["note_link"] = "https://x.com/i/communitynotes/n/" + video_notes["noteId"]
output = video_notes[["tweet_link", "note_link", "summary", "agree", "disagree", "video_duration"]].rename(
    columns={"summary": "note_text"}
)
output.to_csv(OUTPUT_CSV, index=False, quoting=csv.QUOTE_ALL)
print(f"\nOutput: {OUTPUT_CSV}")
print(f"Total rows: {len(output)}")
