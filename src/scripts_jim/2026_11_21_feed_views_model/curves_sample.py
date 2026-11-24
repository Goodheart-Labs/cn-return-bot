# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy"]
# ///
"""Writes a random sample of recorded view curves for the findings page.

Only posts that entered the feed after the recording started, so their first
reading is their real entry, and whose readings run until they are 48 hours
old, so every curve is complete.

    uv run src/scripts_jim/2026_11_21_feed_views_model/curves_sample.py <out.json>
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path.home() / "dev/data/goo-834"
X_EPOCH_MS = 1288834974657
SAMPLE_SIZE = 480
MIN_READINGS = 18
ENTRY_AFTER_START = pd.Timedelta(minutes=15)
# Only posts whose readings run until they are 48 hours old, so every curve is complete.
FULL_AGE_H = 48

views = pd.concat(pd.read_parquet(p, columns=["tweet_id", "observed_at", "impressions"]) for p in sorted((DATA_DIR / "views").glob("*.parquet")))
views["observed_at"] = pd.to_datetime(views["observed_at"], format="ISO8601")
posted_ms = np.right_shift(views["tweet_id"].astype("int64").to_numpy(), 22) + X_EPOCH_MS
views["posted_at"] = pd.to_datetime(posted_ms, unit="ms", utc=True)
views["age_h"] = (views["observed_at"] - views["posted_at"]).dt.total_seconds() / 3600
start = views.observed_at.min()
first_seen = views.groupby("tweet_id").observed_at.transform("min")
counts = views.groupby("tweet_id").observed_at.transform("count")
age_at_entry = views.groupby("tweet_id").age_h.transform("min")
age_at_last = views.groupby("tweet_id").age_h.transform("max")
eligible = views[(first_seen > start + ENTRY_AFTER_START) & (counts >= MIN_READINGS) & (age_at_entry < FULL_AGE_H) & (age_at_last >= FULL_AGE_H)]
ids = eligible.tweet_id.drop_duplicates().sample(SAMPLE_SIZE, random_state=0)
posts = []
for tid in ids:
    s = eligible[eligible.tweet_id == tid].sort_values("age_h")
    posts.append({"id": tid, "posted": s.posted_at.iloc[0].isoformat(), "r": [[round(float(a), 3), int(v)] for a, v in zip(s.age_h, s.impressions)]})
Path(sys.argv[1]).write_text(json.dumps(posts, separators=(",", ":")))
print(f"{len(posts)} posts from {eligible.tweet_id.nunique():,} eligible, data to {views.observed_at.max()}")
