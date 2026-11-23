"""Build the labelled dataset for the tweet filter backtest (GOO-835).

Population: every tweet the X run selected and checked, first seen from
2026-09-15 to 2026-11-05. These are exactly the tweets a filter in front of the
note writers would have seen, already past the feed tiers and the velocity
floor. Tweets after 2026-11-05 are left out, because their notes had less than
8 days to be rated before the public data of 2026-11-13.

Label: `helpful` is true when at least one note by anyone, saying the tweet is
misleading, is "Currently rated helpful" in that public data. That asks whether
a helpful note on the tweet was possible, which is what a filter should judge.
Whether our own writer would have found that note is a separate question.

Split: development is 2026-09-15 to 2026-10-15, test is 2026-10-16 to 2026-11-05.
Everything that is tuned (the prompt, examples, thresholds, the metadata model)
is tuned on development only.

Run from the worktree root:
  uv run --with pandas --with pyarrow src/scripts_jim/2026_11_20_tweet_note_prefilter/build_dataset.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path("/home/jim/dev/data/goo-835")
MISLEADING = "MISINFORMED_OR_POTENTIALLY_MISLEADING"
HELPFUL = "CURRENTLY_RATED_HELPFUL"
NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL"
WINDOW_START = pd.Timestamp("2026-09-15", tz="UTC")
TEST_START = pd.Timestamp("2026-10-16", tz="UTC")
WINDOW_END = pd.Timestamp("2026-11-06", tz="UTC")
# An author's earlier tweet counts towards their history only when we saw it
# at least this long before the current one. By then most of its notes have
# their status, so the history is close to what we could have known then.
AUTHOR_HISTORY_LAG = pd.Timedelta(days=3)
# A note with at least this many ratings has had real attention. If it still
# is not helpful, the raters disagreed, rather than nobody looking.
ATTENDED_NOTE_MIN_RATINGS = 30


def notes_by_tweet(our_note_ids: set[str]) -> pd.DataFrame:
    notes = pd.read_parquet(DATA_DIR / "public_notes_since_2026_08.parquet")
    notes = notes[notes["classification"] == MISLEADING].copy()
    ratings_path = DATA_DIR / "public_rating_counts.parquet"
    if ratings_path.exists():
        ratings = pd.read_parquet(ratings_path).set_index("noteId")
        notes["ratings"] = notes["noteId"].map(ratings.sum(axis=1)).fillna(0)
    else:
        notes["ratings"] = np.nan
    notes["is_helpful"] = notes["currentStatus"] == HELPFUL
    notes["is_not_helpful"] = notes["currentStatus"] == NOT_HELPFUL
    notes["ours"] = notes["noteId"].isin(our_note_ids)
    notes["our_helpful"] = notes["ours"] & notes["is_helpful"]
    notes["attended_unhelpful"] = ~notes["is_helpful"] & (notes["ratings"] >= ATTENDED_NOTE_MIN_RATINGS)
    return notes.groupby("tweetId").agg(
        notes=("noteId", "size"),
        helpful_notes=("is_helpful", "sum"),
        not_helpful_notes=("is_not_helpful", "sum"),
        our_notes=("ours", "sum"),
        our_helpful_notes=("our_helpful", "sum"),
        attended_unhelpful_notes=("attended_unhelpful", "sum"),
        max_ratings=("ratings", "max"),
    )


def first_rows(path: Path) -> pd.DataFrame:
    rows = pd.DataFrame(map(json.loads, open(path)))
    return rows.drop_duplicates("tweet_id", keep="first")


def add_author_history(df: pd.DataFrame) -> pd.DataFrame:
    """For each tweet, count the same author's tweets that we saw at least
    AUTHOR_HISTORY_LAG earlier, and how many of those got a helpful note."""
    df = df.sort_values("first_seen_at").reset_index(drop=True)
    prior_tweets = np.zeros(len(df), dtype=int)
    prior_helpful = np.zeros(len(df), dtype=int)
    prior_noted = np.zeros(len(df), dtype=int)
    for _, group in df.groupby("author_id"):
        seen = group["first_seen_at"].dt.tz_convert(None).to_numpy()
        helpful = group["helpful"].to_numpy().astype(int)
        noted = (group["notes"] > 0).to_numpy().astype(int)
        cutoff_positions = np.searchsorted(seen, seen - AUTHOR_HISTORY_LAG.to_timedelta64(), side="right")
        helpful_cumsum = np.concatenate([[0], np.cumsum(helpful)])
        noted_cumsum = np.concatenate([[0], np.cumsum(noted)])
        prior_tweets[group.index] = cutoff_positions
        prior_helpful[group.index] = helpful_cumsum[cutoff_positions]
        prior_noted[group.index] = noted_cumsum[cutoff_positions]
    df["author_prior_tweets"] = prior_tweets
    df["author_prior_helpful"] = prior_helpful
    df["author_prior_noted"] = prior_noted
    return df


def main() -> None:
    tweets = first_rows(DATA_DIR / "tweets.jsonl").dropna(subset=["tweet_id"])
    extras = first_rows(DATA_DIR / "run_extras.jsonl")
    df = tweets.merge(extras, on="tweet_id", how="left")
    df["first_seen_at"] = pd.to_datetime(df["first_seen_at"], format="ISO8601", utc=True)
    df["posted_at"] = pd.to_datetime(df["posted_at"], format="ISO8601", utc=True)
    by_tweet = notes_by_tweet(set(df["note_id"].dropna()))
    df = df.merge(by_tweet, left_on="tweet_id", right_index=True, how="left")
    count_columns = ["notes", "helpful_notes", "not_helpful_notes", "our_notes", "our_helpful_notes", "attended_unhelpful_notes"]
    df[count_columns] = df[count_columns].fillna(0).astype(int)
    df["helpful"] = df["helpful_notes"] > 0
    df["author_id"] = df["author_id"].fillna(df["tweet_id"])
    df = add_author_history(df)

    df = df[(df["first_seen_at"] >= WINDOW_START) & (df["first_seen_at"] < WINDOW_END)].copy()
    df["split"] = np.where(df["first_seen_at"] < TEST_START, "dev", "test")
    df.to_parquet(DATA_DIR / "dataset.parquet")
    summary = df.groupby("split").agg(tweets=("tweet_id", "size"), helpful=("helpful", "mean"), any_note=("notes", lambda s: (s > 0).mean()))
    print(summary.round(3).to_string())


main()
