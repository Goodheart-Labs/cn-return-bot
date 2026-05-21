"""
How much of the small-vs-large feed helpfulness gap is explained by the
tweet-metadata features the LogReg model uses?

Decomposition:
  - Observed gap = helpful_rate(small) - helpful_rate(large)
  - Predicted gap = mean(predicted P(helpful) | small) - mean(... | large)
  - Fraction explained = predicted_gap / observed_gap

Logic: train the model on BOTH cohorts together. The model only knows the
features (impressions, age, bookmarks, etc.) — it doesn't see feed_size.
If predicted_gap matches observed_gap, the difference is fully attributable
to "small and large feeds served us different *kinds of* tweets". If
predicted_gap < observed_gap, the residual is something the metadata can't
see — likely the note-writing quality difference at the larger feed scale.
"""
import os
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from supabase import create_client

from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import StratifiedKFold, cross_val_predict

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

MIN_AGE_DAYS = 1.5
PAGE = 1000
REQUIRED = [
    "author_followers", "author_tweet_count", "posted_at", "impressions",
    "likes", "retweets", "replies", "quotes", "bookmarks",
]


def fetch_all(table, cols, key, extra=None):
    out, last = [], None
    while True:
        q = sb.table(table).select(cols).order(key).limit(PAGE)
        if last is not None:
            q = q.gt(key, last)
        if extra:
            q = extra(q)
        rows = q.execute().data
        if not rows:
            break
        out.extend(rows)
        last = rows[-1][key]
        if len(rows) < PAGE:
            break
    return out


print("Fetching notes ...")
notes = fetch_all(
    "notes", "note_id, tweet_id, cn_status, submitted_at", "note_id",
    lambda q: q.in_("cn_status", ["CURRENTLY_RATED_HELPFUL", "NEEDS_MORE_RATINGS"])
              .not_.is_("submitted_at", "null"),
)
now = datetime.now(timezone.utc)
cutoff = now - timedelta(days=MIN_AGE_DAYS)
notes = [
    n for n in notes
    if datetime.fromisoformat(n["submitted_at"].replace("Z", "+00:00")) <= cutoff
]
print(f"  -> {len(notes)} mature CRH/NMR submitted notes")

# Per note: what feed_size was it picked under?
print("\nFetching pipeline_runs for feed_size ...")
# Note: feed_size pseudo-AB-test recording was added in PR #142 (mid-May 2026).
# Before that, ab_test_picks->feed_size is missing — but the codebase default
# was always "small", so we treat missing as small (caveat: confounded with
# whatever else changed between then and the experiment window).
note_ids = sorted({n["note_id"] for n in notes})
feed_by_note = {}
for i in range(0, len(note_ids), 50):
    chunk = note_ids[i : i + 50]
    rows = sb.table("pipeline_runs").select("note_id, ab_test_picks").in_("note_id", chunk).execute().data
    for r in rows:
        if not r.get("note_id"):
            continue
        fs = (r.get("ab_test_picks") or {}).get("feed_size") or "small"  # missing => default small
        feed_by_note[r["note_id"]] = fs
    if i and (i // 50) % 10 == 0:
        print(f"  ... {i}/{len(note_ids)}")

# Tweet features
print("Fetching tweets ...")
tweet_ids = sorted({n["tweet_id"] for n in notes})
tweets_by_id = {}
for i in range(0, len(tweet_ids), 200):
    chunk = tweet_ids[i : i + 200]
    cols = "tweet_id, " + ", ".join(REQUIRED) + ", has_video, has_photo, media_count"
    rows = sb.table("tweets").select(cols).in_("tweet_id", chunk).execute().data
    for t in rows:
        tweets_by_id[t["tweet_id"]] = t

# Build dataframe
rows = []
for n in notes:
    t = tweets_by_id.get(n["tweet_id"])
    if not t or any(t.get(c) is None for c in REQUIRED):
        continue
    fs = feed_by_note.get(n["note_id"])
    if fs not in ("small", "large"):
        continue
    submitted = datetime.fromisoformat(n["submitted_at"].replace("Z", "+00:00"))
    posted = datetime.fromisoformat(t["posted_at"].replace("Z", "+00:00"))
    rows.append({
        "feed_size": fs,
        "is_helpful": 1 if n["cn_status"] == "CURRENTLY_RATED_HELPFUL" else 0,
        "tweet_age_at_submission_h": (submitted - posted).total_seconds() / 3600,
        "author_followers": t["author_followers"],
        "author_tweet_count": t["author_tweet_count"],
        "impressions": t["impressions"],
        "likes": t["likes"], "retweets": t["retweets"], "replies": t["replies"],
        "quotes": t["quotes"], "bookmarks": t["bookmarks"],
        "has_video": int(bool(t.get("has_video"))),
        "has_photo": int(bool(t.get("has_photo"))),
        "media_count": t.get("media_count") or 0,
    })

df = pd.DataFrame(rows)
print(f"\nDataset: {len(df)} rows ({sum(df.feed_size == 'small')} small, {sum(df.feed_size == 'large')} large)")

# Observed helpful rate per cohort
print("\n=== OBSERVED helpful rate ===")
for fs in ("small", "large"):
    sub = df[df.feed_size == fs]
    print(f"  {fs:>5}: n={len(sub):>4}  helpful={sub.is_helpful.sum():>3}  rate={sub.is_helpful.mean() * 100:5.2f}%")
obs_small = df[df.feed_size == "small"].is_helpful.mean()
obs_large = df[df.feed_size == "large"].is_helpful.mean()
obs_gap = obs_small - obs_large
print(f"  observed gap (small - large) = {obs_gap * 100:+.2f} pp")

# Train LogReg on the WHOLE pool (both cohorts), use out-of-fold predictions
LOG_COLS = ["author_followers", "author_tweet_count", "impressions",
            "likes", "retweets", "replies", "quotes", "bookmarks", "media_count"]
for c in LOG_COLS:
    df[f"log_{c}"] = np.log1p(df[c].clip(lower=0))
FEATURES = [f"log_{c}" for c in LOG_COLS] + [
    "tweet_age_at_submission_h", "has_video", "has_photo"
]

X = df[FEATURES].to_numpy(dtype=float)
y = df["is_helpful"].to_numpy(dtype=int)

logreg = Pipeline([("scaler", StandardScaler()),
                   ("clf", LogisticRegression(max_iter=1000, C=1.0))])
skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
df["p_oof"] = cross_val_predict(logreg, X, y, cv=skf, method="predict_proba")[:, 1]

print("\n=== PREDICTED helpful rate (out-of-fold mean P(helpful)) ===")
for fs in ("small", "large"):
    sub = df[df.feed_size == fs]
    print(f"  {fs:>5}: mean P(helpful)={sub.p_oof.mean() * 100:5.2f}%")
pred_small = df[df.feed_size == "small"].p_oof.mean()
pred_large = df[df.feed_size == "large"].p_oof.mean()
pred_gap = pred_small - pred_large
print(f"  predicted gap (small - large) = {pred_gap * 100:+.2f} pp")

print("\n=== DECOMPOSITION ===")
print(f"  Observed  gap: {obs_gap * 100:+.2f} pp")
print(f"  Predicted gap: {pred_gap * 100:+.2f} pp")
if abs(obs_gap) > 1e-6:
    frac = pred_gap / obs_gap
    print(f"  Fraction of observed gap explained by tweet metadata: {frac * 100:+.1f}%")
    print(f"  Residual (unexplained): {(obs_gap - pred_gap) * 100:+.2f} pp ({(1 - frac) * 100:+.1f}%)")

# Bootstrap CI on the explained fraction
print("\n=== Bootstrap 95% CI on explained fraction (1000 resamples) ===")
rng = np.random.default_rng(42)
fracs = []
for _ in range(1000):
    idx = rng.integers(0, len(df), len(df))
    sub = df.iloc[idx]
    o_s = sub[sub.feed_size == "small"].is_helpful.mean()
    o_l = sub[sub.feed_size == "large"].is_helpful.mean()
    p_s = sub[sub.feed_size == "small"].p_oof.mean()
    p_l = sub[sub.feed_size == "large"].p_oof.mean()
    if abs(o_s - o_l) < 1e-6:
        continue
    fracs.append((p_s - p_l) / (o_s - o_l))
fracs = np.array(fracs)
print(f"  median: {np.median(fracs) * 100:+.1f}%   "
      f"P2.5: {np.percentile(fracs, 2.5) * 100:+.1f}%   "
      f"P97.5: {np.percentile(fracs, 97.5) * 100:+.1f}%")

# Also: per-feature mean — what's different about large-feed tweets?
print("\n=== MEAN of each (raw) feature by cohort ===")
print(f"  {'feature':28s}  {'small':>10s}  {'large':>10s}  {'large/small':>11s}")
for c in LOG_COLS + ["tweet_age_at_submission_h"]:
    s = df[df.feed_size == "small"][c].mean()
    l = df[df.feed_size == "large"][c].mean()
    ratio = l / s if s else float("nan")
    print(f"  {c:28s}  {s:10.1f}  {l:10.1f}  {ratio:10.2f}x")
