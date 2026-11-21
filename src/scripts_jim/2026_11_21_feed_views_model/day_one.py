# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy"]
# ///
"""Day one checks on the recorded views (GOO-843).

1. How often X refreshes a view count: the share of consecutive readings of one
   post, 10 minutes apart, where the count did not move.
2. Whether the XL order means anything: how stable a post's rank is from one
   walk to the next, and what it correlates with.
3. Why posts leave XL: how old a post is at its last reading.

    uv run src/scripts_jim/2026_11_21_feed_views_model/day_one.py
"""

from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

DATA_DIR = Path.home() / "dev/data/goo-834"
views = pd.concat(pd.read_parquet(p) for p in sorted((DATA_DIR / "views").glob("*.parquet")))
views["observed_at"] = pd.to_datetime(views["observed_at"], format="ISO8601")
walks = pd.read_parquet(DATA_DIR / "walks.parquet")
walks["started_at"] = pd.to_datetime(walks["started_at"], format="ISO8601")
# A tweet id is an X "snowflake": its top bits are milliseconds since X's epoch.
X_EPOCH_MS = 1288834974657
views["posted_at"] = pd.to_datetime(np.right_shift(views["tweet_id"].astype("int64").to_numpy(), 22) + X_EPOCH_MS, unit="ms", utc=True)
views["age_h"] = (views["observed_at"] - views["posted_at"]).dt.total_seconds() / 3600
views = views.sort_values(["tweet_id", "observed_at"])
print(f"{len(views):,} readings of {views.tweet_id.nunique():,} posts, {views.observed_at.min()} to {views.observed_at.max()}")

# 1. Freshness.
g = views.groupby("tweet_id")
views["prev_imp"] = g["impressions"].shift()
views["gap_min"] = g["observed_at"].diff().dt.total_seconds() / 60
pairs = views[(views.gap_min > 5) & (views.gap_min < 15)]
unchanged = (pairs.impressions == pairs.prev_imp).mean()
print(f"\n1. Of {len(pairs):,} pairs of readings 10 minutes apart, {unchanged:.1%} had the same view count.")
for lo, hi in [(0, 6), (6, 12), (12, 24), (24, 48), (48, 1e9)]:
    p = pairs[(pairs.age_h >= lo) & (pairs.age_h < hi)]
    growth = (p.impressions / p.prev_imp.clip(lower=1) - 1)
    print(f"   age {lo}-{hi if hi < 1e9 else 'more'} h: {len(p):>7,} pairs, unchanged {(p.impressions == p.prev_imp).mean():.1%}, median growth per 10 min {growth.median():.2%}")
decreased = (pairs.impressions < pairs.prev_imp).mean()
print(f"   counts that went down: {decreased:.2%}")

# 2. Rank.
views["prev_rank"] = g["xl_rank"].shift()
rp = views[(views.gap_min > 5) & (views.gap_min < 15)]
print(f"\n2. Rank from one walk to the next: Spearman {spearmanr(rp.xl_rank, rp.prev_rank).statistic:.2f}")
last_walk = views[views.observed_at >= views.observed_at.max() - pd.Timedelta(minutes=5)].copy()
last_walk["velocity"] = last_walk.impressions / last_walk.age_h.clip(lower=0.25)
for col in ["age_h", "impressions", "velocity"]:
    print(f"   rank vs {col} in the last walk: Spearman {spearmanr(last_walk.xl_rank, last_walk[col]).statistic:.2f}")
print("   tier by rank decile in the last walk:")
last_walk["decile"] = pd.qcut(last_walk.xl_rank, 10, labels=False)
print(last_walk.groupby("decile").tier.value_counts(normalize=True).unstack().round(2).to_string())

# 3. Leaving.
complete = walks[walks.complete]
# The last complete walk whose readings are in the export.
last_complete = complete.started_at[complete.started_at < views.observed_at.max()].max()
last_seen = g.agg(last=("observed_at", "max"), first=("observed_at", "min"), age_last=("age_h", "max"), age_first=("age_h", "min"), imp_last=("impressions", "max"))
start = views.observed_at.min()
left = last_seen[last_seen["last"] < last_complete]
still_in = last_seen[last_seen["last"] >= last_complete]
print(f"   age of posts still in XL at the last walk, quantiles 10/50/90 %: {np.round(still_in.age_last.quantile([.1, .5, .9]).values, 1)}, oldest {still_in.age_last.max():.1f} h")
print(f"\n3. {len(left):,} of {len(last_seen):,} posts left XL before the last complete walk.")
print("   age at last reading, quantiles 10/25/50/75/90 %:", np.round(left.age_last.quantile([.1, .25, .5, .75, .9]).values, 1))
entered = last_seen[last_seen["first"] > start + pd.Timedelta(minutes=15)]
print(f"   {len(entered):,} posts entered during the recording. Age at entry, quantiles 10/25/50/75/90 %:", np.round(entered.age_first.quantile([.1, .25, .5, .75, .9]).values, 1))
gaps = views[views.gap_min > 15]
print(f"   readings after a gap of more than one walk: {len(gaps):,}; walks missing from the schedule: {sorted(set(pd.date_range(walks.started_at.min().floor('10min'), views.observed_at.max(), freq='10min')) - set(walks.started_at.dt.floor('10min')))}")
