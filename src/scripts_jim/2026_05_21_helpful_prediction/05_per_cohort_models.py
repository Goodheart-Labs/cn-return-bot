"""
Fit one LogReg per feed-size cohort (small, large) and compare:
  - CV AUC / AP / LogLoss / Brier per cohort
  - Coefficients side-by-side
  - Cross-apply each cohort's model to the other cohort

CAVEAT: large cohort = 159 rows / 11 positives. Each 5-fold CV bucket has
~2 positives, so AUC has ±~0.10 noise. Coefficients are heavily
regularization-dominated. Read directional differences, not magnitudes.
"""
import os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from supabase import create_client

from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import (
    roc_auc_score, average_precision_score, log_loss, brier_score_loss,
)

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
LOG_COLS = ["author_followers", "author_tweet_count", "impressions",
            "likes", "retweets", "replies", "quotes", "bookmarks", "media_count"]


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
notes = [n for n in notes
         if datetime.fromisoformat(n["submitted_at"].replace("Z", "+00:00")) <= cutoff]
print(f"  -> {len(notes)} mature CRH/NMR submitted notes")

print("\nFetching pipeline_runs for feed_size (50/chunk) ...")
note_ids = sorted({n["note_id"] for n in notes})
feed_by_note = {}
for i in range(0, len(note_ids), 25):
    chunk = note_ids[i : i + 25]
    rows = sb.table("pipeline_runs").select("note_id, ab_test_picks").in_("note_id", chunk).execute().data
    for r in rows:
        if not r.get("note_id"):
            continue
        fs = (r.get("ab_test_picks") or {}).get("feed_size") or "small"  # default
        feed_by_note[r["note_id"]] = fs
    if i and (i // 25) % 20 == 0:
        print(f"  ... {i}/{len(note_ids)}")

print("\nFetching tweets ...")
tweet_ids = sorted({n["tweet_id"] for n in notes})
tweets_by_id = {}
for i in range(0, len(tweet_ids), 200):
    chunk = tweet_ids[i : i + 200]
    cols = "tweet_id, " + ", ".join(REQUIRED) + ", has_video, has_photo, media_count"
    rows = sb.table("tweets").select(cols).in_("tweet_id", chunk).execute().data
    for t in rows:
        tweets_by_id[t["tweet_id"]] = t

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

for c in LOG_COLS:
    df[f"log_{c}"] = np.log1p(df[c].clip(lower=0))
FEATURES = [f"log_{c}" for c in LOG_COLS] + [
    "tweet_age_at_submission_h", "has_video", "has_photo"
]

print(f"\n=== Cohort sizes ===")
for fs in ("small", "large"):
    sub = df[df.feed_size == fs]
    print(f"  {fs:>5}: n={len(sub):>4}  positives={sub.is_helpful.sum():>3}  "
          f"rate={sub.is_helpful.mean() * 100:5.2f}%")


def fit_logreg(X, y):
    return Pipeline([("scaler", StandardScaler()),
                     ("clf", LogisticRegression(max_iter=1000, C=1.0))]).fit(X, y)


def cv_metrics(X, y, label):
    if y.sum() < 5:
        print(f"  {label}: only {y.sum()} positives — skipping CV")
        return None
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    p = cross_val_predict(
        Pipeline([("scaler", StandardScaler()),
                  ("clf", LogisticRegression(max_iter=1000, C=1.0))]),
        X, y, cv=skf, method="predict_proba",
    )[:, 1]
    auc = roc_auc_score(y, p); ap = average_precision_score(y, p)
    ll = log_loss(y, p, labels=[0, 1]); br = brier_score_loss(y, p)
    pri = np.full_like(y, y.mean(), dtype=float)
    ll0 = log_loss(y, pri, labels=[0, 1])
    print(f"  {label}: AUC={auc:.3f}  AP={ap:.3f}  LogLoss={ll:.3f} (prior {ll0:.3f})  Brier={br:.3f}")
    return p


# ---- per-cohort CV ----
print("\n=== 5-fold CV per cohort ===")
for fs in ("small", "large"):
    sub = df[df.feed_size == fs].reset_index(drop=True)
    cv_metrics(sub[FEATURES].to_numpy(float), sub["is_helpful"].to_numpy(int), fs)

# ---- fit on full cohort, inspect coefficients ----
print("\n=== Coefficients (standardized, fit on full cohort) ===")
print(f"  {'feature':28s}  {'small':>8s}  {'large':>8s}  {'Δ (l-s)':>10s}")
small = df[df.feed_size == "small"]
large = df[df.feed_size == "large"]

mS = fit_logreg(small[FEATURES].to_numpy(float), small["is_helpful"].to_numpy(int))
mL = fit_logreg(large[FEATURES].to_numpy(float), large["is_helpful"].to_numpy(int))
cS, cL = mS.named_steps["clf"].coef_[0], mL.named_steps["clf"].coef_[0]

order = np.argsort(-np.abs(cS - cL))  # sort by biggest disagreement
for i in order:
    sym = " " if (cS[i] * cL[i]) >= 0 else "*"  # mark sign flips
    print(f"  {FEATURES[i]:28s}  {cS[i]:+8.3f}  {cL[i]:+8.3f}  {cL[i] - cS[i]:+10.3f}{sym}")
print("  (*) marks features where the sign flipped between cohorts")

# ---- cross-apply: how well does small-model predict large, and vice versa? ----
print("\n=== Cross-cohort AUC (fit on A, evaluate on B) ===")
for fitname, fitmodel in [("small", mS), ("large", mL)]:
    for evalname in ("small", "large"):
        sub = df[df.feed_size == evalname]
        p = fitmodel.predict_proba(sub[FEATURES].to_numpy(float))[:, 1]
        if sub.is_helpful.sum() < 2:
            print(f"  fit={fitname} -> eval={evalname}: too few positives")
            continue
        auc = roc_auc_score(sub["is_helpful"], p)
        print(f"  fit={fitname:>5} -> eval={evalname:>5}: AUC={auc:.3f}  mean P(h)={p.mean()*100:.2f}%")

# ---- coefficient comparison plot ----
fig, ax = plt.subplots(figsize=(9, 6))
ypos = np.arange(len(FEATURES))
w = 0.4
ax.barh(ypos - w / 2, cS, w, label=f"small (n={len(small)}, +{int(small.is_helpful.sum())})", color="tab:blue")
ax.barh(ypos + w / 2, cL, w, label=f"large (n={len(large)}, +{int(large.is_helpful.sum())})", color="tab:orange")
ax.set_yticks(ypos)
ax.set_yticklabels(FEATURES)
ax.axvline(0, color="k", lw=0.5)
ax.set_xlabel("Standardized LogReg coefficient")
ax.set_title("Per-cohort LogReg coefficients")
ax.legend(loc="lower right")
ax.invert_yaxis()
plt.tight_layout()
out = HERE / "coefficients_per_cohort.png"
plt.savefig(out, dpi=130)
plt.close()
print(f"\nWrote {out}")
