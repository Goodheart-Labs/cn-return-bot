"""
Train logistic regression: P(CURRENTLY_RATED_HELPFUL | tweet metrics) for
large-feed notes that ended up CRH or NMR.

Because the dataset is small (the 7-day window has only ~16 positives), the
honest evaluation is:
  - L2-regularized logistic regression (StandardScaler -> LogisticRegression)
  - REPEATED stratified 5-fold CV (20 repeats) -> AUC mean +/- std
    (a single 5-fold split puts ~3 positives per fold; one split's AUC is noise)
  - a PERMUTATION TEST: shuffle labels, recompute CV AUC many times; the
    p-value is how often noise beats the real fit. This is the load-bearing
    number for "is there any signal at all".
  - standardized coefficients (exploratory: direction only, wide error bars)

CLI:
  uv run 02_train.py          -> dataset.csv      (requested 7-day window)
  uv run 02_train.py --all    -> dataset_all.csv  (all large-feed history)
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import (
    RepeatedStratifiedKFold, cross_val_score, cross_val_predict, StratifiedKFold,
)
from sklearn.metrics import roc_auc_score, roc_curve

HERE = Path(__file__).resolve().parent
USE_ALL = "--all" in sys.argv
df = pd.read_csv(HERE / ("dataset_all.csv" if USE_ALL else "dataset.csv"))
label = "ALL large-feed history" if USE_ALL else "large feed, last 7d excl. last 24h"

n, pos = len(df), int(df["is_helpful"].sum())
print(f"=== {label} ===")
print(f"n={n}  positives(CRH)={pos} ({100*pos/n:.1f}%)  negatives(NMR)={n-pos}\n")

# ---- features: log-transform heavy-tailed counts, keep flags/age linear ----
LOG_COLS = [
    "author_followers", "author_tweet_count", "impressions",
    "likes", "retweets", "replies", "quotes", "bookmarks", "media_count",
]
for c in LOG_COLS:
    df[f"log_{c}"] = np.log1p(df[c].clip(lower=0))
FEATURES = [f"log_{c}" for c in LOG_COLS] + [
    "tweet_age_at_submission_h", "has_video", "has_photo",
]
X = df[FEATURES].to_numpy(float)
y = df["is_helpful"].to_numpy(int)
print(f"features ({len(FEATURES)}): {FEATURES}\n")

model = Pipeline([
    ("scaler", StandardScaler()),
    ("clf", LogisticRegression(max_iter=2000, C=1.0)),  # L2; no class_weight -> calibrated P
])

# ---- repeated stratified CV AUC ----
rkf = RepeatedStratifiedKFold(n_splits=5, n_repeats=20, random_state=42)
aucs = cross_val_score(model, X, y, scoring="roc_auc", cv=rkf)
auc_mean, auc_std = aucs.mean(), aucs.std()
print(f"Repeated 5-fold CV AUC: {auc_mean:.3f} +/- {auc_std:.3f}  "
      f"(across {len(aucs)} folds; 0.50 = chance)")

# ---- permutation test: is the AUC better than label-shuffled noise? ----
N_PERM = 300
rng = np.random.RandomState(0)
perm_cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=4, random_state=7)
real = cross_val_score(model, X, y, scoring="roc_auc", cv=perm_cv).mean()
null = np.empty(N_PERM)
for i in range(N_PERM):
    yp = rng.permutation(y)
    null[i] = cross_val_score(model, X, yp, scoring="roc_auc", cv=perm_cv).mean()
p_value = (np.sum(null >= real) + 1) / (N_PERM + 1)
print(f"Permutation test: real CV AUC={real:.3f}, "
      f"null mean={null.mean():.3f} (95th pct={np.percentile(null,95):.3f}), "
      f"p={p_value:.3f}")

# ---- pooled out-of-fold predictions for one ROC curve ----
oof = cross_val_predict(
    model, X, y, cv=StratifiedKFold(5, shuffle=True, random_state=42),
    method="predict_proba",
)[:, 1]
print(f"Pooled OOF AUC (single split): {roc_auc_score(y, oof):.3f}")

# ---- standardized coefficients (full-data fit; direction only) ----
model.fit(X, y)
coefs = model.named_steps["clf"].coef_[0]
print("\nStandardized coefficients (full-data fit; EXPLORATORY, wide CIs):")
print(f"  {'feature':30s}  {'coef':>7s}  higher value =>")
for i in np.argsort(-np.abs(coefs)):
    direction = "more likely HELPFUL" if coefs[i] > 0 else "more likely NMR"
    print(f"  {FEATURES[i]:30s}  {coefs[i]:+.3f}  {direction}")

# ====================== plot ======================
fig, axes = plt.subplots(1, 2, figsize=(13, 5))

ax = axes[0]
fpr, tpr, _ = roc_curve(y, oof)
ax.plot(fpr, tpr, label=f"LogReg (pooled OOF AUC={roc_auc_score(y, oof):.2f})")
ax.plot([0, 1], [0, 1], "k--", alpha=0.4, label="chance")
ax.set_xlabel("False positive rate"); ax.set_ylabel("True positive rate")
ax.set_title(f"ROC  (n={n}, pos={pos})\nrepeated-CV AUC={auc_mean:.2f}±{auc_std:.2f}, perm p={p_value:.2f}")
ax.legend(loc="lower right"); ax.grid(alpha=0.3)

ax = axes[1]
order = np.argsort(coefs)
ax.barh([FEATURES[i] for i in order], coefs[order],
        color=["tab:red" if c < 0 else "tab:green" for c in coefs[order]])
ax.axvline(0, color="k", lw=0.5)
ax.set_xlabel("Standardized coefficient  (>0 => more likely HELPFUL)")
ax.set_title("Feature direction (exploratory)")

plt.suptitle(label, fontweight="bold")
plt.tight_layout()
out = HERE / ("diagnostics_all.png" if USE_ALL else "diagnostics.png")
plt.savefig(out, dpi=130)
print(f"\nWrote {out}")
