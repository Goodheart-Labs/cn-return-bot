"""
Train a model to predict P(CURRENTLY_RATED_HELPFUL | tweet features) for
notes that ended up either CRH or NMR (we ignore NH per spec).

Primary model: LogisticRegression (the correct choice for binary outcome
with probability output — sklearn's LinearRegression on a 0/1 target is
also reported for comparison since the user asked for "linear regression").

Outputs: stdout stats + plots in this folder.
"""
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path

from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import (
    roc_auc_score, log_loss, brier_score_loss, accuracy_score,
    confusion_matrix, roc_curve, precision_recall_curve, average_precision_score,
)
from sklearn.calibration import calibration_curve
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance

HERE = Path(__file__).resolve().parent
df = pd.read_csv(HERE / "dataset.csv")
print(f"Loaded {len(df)} rows, {df['is_helpful'].sum()} positive ({df['is_helpful'].mean() * 100:.1f}%)")

# ---- feature engineering ----
# Log-transform heavy-tailed counts (followers/impressions/likes span many decades).
LOG_COLS = [
    "author_followers", "author_tweet_count", "impressions",
    "likes", "retweets", "replies", "quotes", "bookmarks",
    "media_count",
]
for c in LOG_COLS:
    df[f"log_{c}"] = np.log1p(df[c].clip(lower=0))

FEATURES = (
    [f"log_{c}" for c in LOG_COLS]
    + ["tweet_age_at_submission_h", "has_video", "has_photo"]
)

X = df[FEATURES].to_numpy(dtype=float)
y = df["is_helpful"].to_numpy(dtype=int)

print(f"\nFeatures ({len(FEATURES)}): {FEATURES}")

# ---- cross-validated probabilities ----
skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

logreg = Pipeline([
    ("scaler", StandardScaler()),
    # No class_weight: we want *calibrated* P(helpful), not balanced ranking.
    # class_weight='balanced' would push most preds >0.5 because the model
    # would treat the prior as 50/50, ruining the "likelihood" interpretation.
    ("clf", LogisticRegression(max_iter=1000, C=1.0)),
])
proba_logreg = cross_val_predict(logreg, X, y, cv=skf, method="predict_proba")[:, 1]

# sklearn LinearRegression on the 0/1 target — for comparison only.
# Clip predictions to [0,1] so log_loss is defined.
linreg = Pipeline([
    ("scaler", StandardScaler()),
    ("reg", LinearRegression()),
])
proba_linreg = np.clip(cross_val_predict(linreg, X, y, cv=skf), 1e-6, 1 - 1e-6)

# Tiny random-forest baseline — tells us how much signal linear is leaving on the table.
rf = RandomForestClassifier(n_estimators=300, max_depth=4, random_state=42)
proba_rf = cross_val_predict(rf, X, y, cv=skf, method="predict_proba")[:, 1]

# Baseline: predict the prior for everyone
prior = y.mean()
proba_prior = np.full_like(y, prior, dtype=float)

# ---- metrics ----
def report(name, p):
    auc = roc_auc_score(y, p)
    ll = log_loss(y, p, labels=[0, 1])
    br = brier_score_loss(y, p)
    ap = average_precision_score(y, p)
    pred = (p >= 0.5).astype(int)
    acc = accuracy_score(y, pred)
    print(f"  {name:18s}  AUC={auc:.3f}  AP={ap:.3f}  LogLoss={ll:.3f}  Brier={br:.3f}  Acc@0.5={acc:.3f}")
    return auc, ap, ll, br

print("\n=== 5-fold cross-validated metrics ===")
report("prior (baseline)", proba_prior)
report("LinearRegression",  proba_linreg)
report("LogisticRegression", proba_logreg)
report("RandomForest",      proba_rf)

# ---- confusion matrix at 0.5 (logistic) ----
pred_log = (proba_logreg >= 0.5).astype(int)
cm = confusion_matrix(y, pred_log)
print(f"\nLogReg confusion @ 0.5 threshold (rows=truth, cols=pred):")
print(f"           pred=NMR  pred=CRH")
print(f"  NMR       {cm[0,0]:6d}    {cm[0,1]:6d}")
print(f"  CRH       {cm[1,0]:6d}    {cm[1,1]:6d}")

# ---- standardised coefficients (fit on full data, just for inspection) ----
logreg.fit(X, y)
coefs = logreg.named_steps["clf"].coef_[0]
order = np.argsort(-np.abs(coefs))
print("\n=== LogReg standardized coefficients (sorted by |coef|) ===")
print(f"  {'feature':28s}  {'coef':>7s}  direction")
for i in order:
    direction = "more helpful" if coefs[i] > 0 else "less helpful"
    print(f"  {FEATURES[i]:28s}  {coefs[i]:+.3f}  -> higher value => {direction}")

# ---- permutation importance on logreg (CV-based) ----
print("\n=== Permutation importance (LogReg, on training fit; AUC drop) ===")
logreg.fit(X, y)
perm = permutation_importance(
    logreg, X, y, scoring="roc_auc", n_repeats=20, random_state=42, n_jobs=-1
)
order = np.argsort(-perm.importances_mean)
for i in order:
    print(f"  {FEATURES[i]:28s}  ΔAUC={perm.importances_mean[i]:+.4f} ± {perm.importances_std[i]:.4f}")

# ====================== PLOTS ======================
fig, axes = plt.subplots(2, 2, figsize=(12, 9))

# -- ROC curve --
ax = axes[0, 0]
for name, p in [("LinearReg", proba_linreg), ("LogisticReg", proba_logreg), ("RandomForest", proba_rf)]:
    fpr, tpr, _ = roc_curve(y, p)
    auc = roc_auc_score(y, p)
    ax.plot(fpr, tpr, label=f"{name} (AUC={auc:.2f})")
ax.plot([0, 1], [0, 1], "k--", alpha=0.4, label="random")
ax.set_xlabel("False positive rate")
ax.set_ylabel("True positive rate")
ax.set_title(f"ROC (n={len(y)}, pos={y.sum()})")
ax.legend(loc="lower right", fontsize=9)
ax.grid(alpha=0.3)

# -- Precision-recall --
ax = axes[0, 1]
for name, p in [("LinearReg", proba_linreg), ("LogisticReg", proba_logreg), ("RandomForest", proba_rf)]:
    pr, rc, _ = precision_recall_curve(y, p)
    ap = average_precision_score(y, p)
    ax.plot(rc, pr, label=f"{name} (AP={ap:.2f})")
ax.axhline(prior, color="k", ls="--", alpha=0.4, label=f"prior={prior:.2f}")
ax.set_xlabel("Recall")
ax.set_ylabel("Precision")
ax.set_title("Precision-Recall")
ax.legend(loc="upper right", fontsize=9)
ax.grid(alpha=0.3)

# -- Calibration --
ax = axes[1, 0]
for name, p in [("LinearReg", proba_linreg), ("LogisticReg", proba_logreg), ("RandomForest", proba_rf)]:
    prob_true, prob_pred = calibration_curve(y, p, n_bins=8, strategy="quantile")
    ax.plot(prob_pred, prob_true, "o-", label=name)
ax.plot([0, 1], [0, 1], "k--", alpha=0.4)
ax.set_xlabel("Predicted P(helpful)")
ax.set_ylabel("Observed fraction helpful")
ax.set_title("Calibration (quantile bins)")
ax.legend(fontsize=9)
ax.grid(alpha=0.3)

# -- Predicted-probability histogram split by class (LogReg) --
ax = axes[1, 1]
bins = np.linspace(0, 1, 21)
ax.hist(proba_logreg[y == 0], bins=bins, alpha=0.55, label="actual NMR", color="tab:red")
ax.hist(proba_logreg[y == 1], bins=bins, alpha=0.55, label="actual CRH", color="tab:green")
ax.set_xlabel("Predicted P(helpful)  [LogReg]")
ax.set_ylabel("count")
ax.set_title("Predicted-prob histogram by true class")
ax.legend(fontsize=9)
ax.grid(alpha=0.3)

plt.tight_layout()
out_main = HERE / "model_diagnostics.png"
plt.savefig(out_main, dpi=130)
plt.close()
print(f"\nWrote {out_main}")

# -- Coefficient bar chart --
fig, ax = plt.subplots(figsize=(8, 5))
order = np.argsort(coefs)
ax.barh(
    [FEATURES[i] for i in order], coefs[order],
    color=["tab:red" if c < 0 else "tab:green" for c in coefs[order]],
)
ax.axvline(0, color="k", lw=0.5)
ax.set_xlabel("Standardized LogReg coefficient")
ax.set_title("Feature contribution to P(helpful)")
plt.tight_layout()
out_coef = HERE / "coefficients.png"
plt.savefig(out_coef, dpi=130)
plt.close()
print(f"Wrote {out_coef}")
