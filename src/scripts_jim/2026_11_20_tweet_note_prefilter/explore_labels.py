"""First look: how often does a tweet we checked end up with a helpful note? (GOO-835)

Joins the tweets we checked with the public notes on them and prints the share
of tweets with at least one helpful note, sliced by week, feed tier, views and
how our own check ended.

Run from the worktree root:
  uv run --with pandas --with pyarrow src/scripts_jim/2026_11_20_tweet_note_prefilter/explore_labels.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path("/home/jim/dev/data/goo-835")
MISLEADING = "MISINFORMED_OR_POTENTIALLY_MISLEADING"
HELPFUL = "CURRENTLY_RATED_HELPFUL"
NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL"

tweets = pd.DataFrame(map(json.loads, open(DATA_DIR / "tweets.jsonl")))
notes = pd.read_parquet(DATA_DIR / "public_notes_since_2026_08.parquet")
notes = notes[notes["classification"] == MISLEADING]
ours = set(tweets["note_id"].dropna())
notes["ours"] = notes["noteId"].isin(ours)
notes["is_helpful"] = notes["currentStatus"] == HELPFUL
notes["is_not_helpful"] = notes["currentStatus"] == NOT_HELPFUL
notes["no_status"] = notes["currentStatus"].isna()
notes["our_helpful"] = notes["ours"] & notes["is_helpful"]
by_tweet = notes.groupby("tweetId").agg(
    notes=("noteId", "size"),
    helpful=("is_helpful", "sum"),
    not_helpful=("is_not_helpful", "sum"),
    no_status=("no_status", "sum"),
    our_notes=("ours", "sum"),
    our_helpful=("our_helpful", "sum"),
)
df = tweets.merge(by_tweet, left_on="tweet_id", right_index=True, how="left").fillna({"notes": 0, "helpful": 0, "not_helpful": 0, "our_notes": 0, "our_helpful": 0, "no_status": 0})
df["first_seen_at"] = pd.to_datetime(df["first_seen_at"], format="ISO8601")
df["week"] = df["first_seen_at"].dt.to_period("W").dt.start_time.dt.date
df["any_helpful"] = df["helpful"] > 0
df["other_notes"] = df["notes"] - df["our_notes"]
df["impressions"] = pd.to_numeric(df["impressions"])


def summary(group):
    return pd.Series({
        "tweets": len(group),
        "any_note": (group["notes"] > 0).mean(),
        "other_note": (group["other_notes"] > 0).mean(),
        "any_helpful": group["any_helpful"].mean(),
        "our_helpful": (group["our_helpful"] > 0).mean(),
        "mean_notes": group["notes"].mean(),
    })


pd.set_option("display.width", 200)
print("By week of first sight:")
print(df.groupby("week").apply(summary).round(3).to_string())
window = df[(df["first_seen_at"] >= "2026-10-01") & (df["first_seen_at"] < "2026-11-06")]
print("\n2026-10-01 to 2026-11-05, by feed tier:")
print(window.groupby(window["feed_size"].fillna("none")).apply(summary).round(3).to_string())
print("\nby impressions at first sight:")
bins = [0, 1e5, 3e5, 1e6, 3e6, 1e7, np.inf]
print(window.groupby(pd.cut(window["impressions"], bins)).apply(summary).round(3).to_string())
print("\nby our outcome:")
print(window.groupby([window["outcome"].fillna("none"), window["outcome_reason"].fillna("")]).apply(summary).round(3).to_string())
print("\nby bot:")
print(window.groupby(window["bot"].fillna("none")).apply(summary).round(3).to_string())
print("\nby lang (top):")
lang = window["lang"].fillna("?")
top = lang.value_counts().head(8).index
print(window[lang.isin(top)].groupby(lang).apply(summary).round(3).to_string())
df.to_parquet(DATA_DIR / "tweets_labelled.parquet")
