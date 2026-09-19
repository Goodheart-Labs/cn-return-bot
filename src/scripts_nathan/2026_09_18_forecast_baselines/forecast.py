# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""Walk-forward baseline forecasters for P(H), P(NH), P(rated) at submit time.

OFFLINE. Reads the parquet files pulled by ../2026_09_18_outcome_screen/pull.py and
reuses that folder's load() and build() for the joins. No database, no LLM, no X API.
Writes data/predictions.parquet (one row per note x forecaster x target) and
data/run_meta.json.  Run:  uv run forecast.py

Label lag: models and base rates are refit once per UTC calendar day D of submit time
and may only see notes with submitted_at < D - 7 days. Every note submitted on day D
is predicted by that day's fit.

All settings below were fixed before any result was looked at. One setting per model.
"""
import json, sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression

sys.dont_write_bytecode = True  # do not touch the screen folder's __pycache__
HERE = Path(__file__).resolve().parent
SCREEN = HERE.parent / "2026_09_18_outcome_screen"
sys.path.insert(0, str(SCREEN))
from screen import load, build  # noqa: E402  (read-only reuse of the joins)

OUT = HERE / "data"
LAG = pd.Timedelta(days=7)
MIN_TRAIN_SCORED = 400     # scoring starts on the first day with this many label-available window notes
MIN_TRAIN_BURN = 100       # unscored burn-in predictions (only used to feed the Platt recalibrator)
MIN_POS = 5                # a model with fewer training positives than this outputs prior_30d
PRIOR_WINDOW = pd.Timedelta(days=30)
PRIOR_SHRINK_M = 50        # pseudo-notes of prior_all mixed into prior_30d
LOGIT_C = 1.0
GBM = dict(n_estimators=100, max_depth=2, learning_rate=0.05, subsample=0.8, min_samples_leaf=20, random_state=0)
PLATT_MIN_N, PLATT_MIN_POS, PLATT_C = 300, 15, 1e4
TARGETS = ["H", "NH", "rated"]
CLIP = (0.001, 0.999)

CONT = ["age_h", "eval_score", "n_before_c", "tier", "log_velocity", "log_followers", "media_count"]
FEATS = {
    "eval_only": ["eval_score", "eval_missing"],
    "stable4": ["has_earlier", "age_h", "feed_missing", "hist_noH", "hist_H", "eval_score", "eval_missing"],
    "stable4_no_earlier": ["age_h", "feed_missing", "hist_noH", "hist_H", "eval_score", "eval_missing"],
    "gbm_canary": ["has_earlier", "n_before_c", "age_h", "feed_missing", "hist_noH", "hist_H", "eval_score",
                   "eval_missing", "tier", "log_velocity", "log_followers", "has_video", "has_photo",
                   "media_count", "is_quote"],
}
MODELS = list(FEATS)


def features(df):
    X = pd.DataFrame(index=df.index)
    feed = df["has_feed"].values
    X["has_earlier"] = (df["n_before"] >= 1).astype(float)
    X["n_before_c"] = df["n_before"].clip(upper=5).astype(float)
    hrs = (df["feed_first_seen_at"] - df["posted_at"]).dt.total_seconds() / 3600
    X["age_h"] = hrs.clip(lower=0, upper=48)
    X["feed_missing"] = (~df["has_feed"]).astype(float)
    X["hist_noH"] = ((df["n_prior"] > 0) & (df["n_prior_H"] == 0)).astype(float)
    X["hist_H"] = (df["n_prior_H"] > 0).astype(float)
    X["eval_score"] = df["eval_score"]
    X["eval_missing"] = df["eval_score"].isna().astype(float)
    X["tier"] = df["first_seen_feed_size"].map({"small": 0.0, "large": 1.0, "xl": 2.0})
    X["log_velocity"] = np.log10(df["first_seen_impressions"] / hrs.clip(lower=0.25) + 1)
    X["log_followers"] = np.log10(df["author_followers"] + 1)
    X["has_video"] = df["has_video"].astype(float)
    X["has_photo"] = df["has_photo"].astype(float)
    X["media_count"] = df["media_count"].astype(float)
    X["is_quote"] = df["referenced_tweets"].map(
        lambda s: float("quoted" in [r.get("type") for r in json.loads(s)]) if isinstance(s, str) and s != "null" else 0.0)
    feed_cols = ["age_h", "tier", "log_velocity", "log_followers", "has_video", "has_photo", "media_count", "is_quote"]
    X.loc[~feed, feed_cols] = np.nan
    return X


def fit_predict(name, Xtr, ytr, Xte):
    cols = FEATS[name]
    Xtr, Xte = Xtr[cols].copy(), Xte[cols].copy()
    med = Xtr.median()                      # imputation values come from the training rows only
    med = med.fillna(0.0)
    Xtr, Xte = Xtr.fillna(med), Xte.fillna(med)
    if name == "gbm_canary":
        m = GradientBoostingClassifier(**GBM).fit(Xtr.values, ytr)
    else:
        for c in [c for c in cols if c in CONT]:   # scale with training mean/sd only
            mu, sd = Xtr[c].mean(), Xtr[c].std()
            sd = sd if sd > 0 else 1.0
            Xtr[c], Xte[c] = (Xtr[c] - mu) / sd, (Xte[c] - mu) / sd
        m = LogisticRegression(C=LOGIT_C, max_iter=1000).fit(Xtr.values, ytr)
    return m.predict_proba(Xte.values)[:, 1]


def logit(p):
    p = np.clip(p, *CLIP)
    return np.log(p / (1 - p))


def main():
    OUT.mkdir(exist_ok=True)
    meta, pulled_at, cutoff, t = load()
    notes_all, _, df = build(t, cutoff)          # df = matured window notes, one row per note
    df = df.sort_values("when").reset_index(drop=True)
    assert df["note_id"].is_unique
    X = features(df)
    hist = notes_all[["when", "H", "NH", "rated"]].sort_values("when")   # full note history, for the priors

    days = pd.date_range(df["when"].min().floor("D"), df["when"].max().floor("D"), freq="D")
    rows, daylog = [], []
    for D in days:
        horizon = D - LAG
        te = df.index[(df["when"] >= D) & (df["when"] < D + pd.Timedelta(days=1))]
        tr = df.index[df["when"] < horizon]
        if len(te) == 0 or len(tr) < MIN_TRAIN_BURN:
            continue
        scored = len(tr) >= MIN_TRAIN_SCORED
        h_all = hist[hist["when"] < horizon]
        h_30 = h_all[h_all["when"] >= horizon - PRIOR_WINDOW]
        log = dict(day=str(D.date()), n_test=len(te), n_train=len(tr), scored=scored, n_prior_all=len(h_all), n_prior_30d=len(h_30))
        for tg in TARGETS:
            p_all = h_all[tg].mean()
            p_30 = (h_30[tg].sum() + PRIOR_SHRINK_M * p_all) / (len(h_30) + PRIOR_SHRINK_M)
            ytr = df.loc[tr, tg].values
            log[f"train_pos_{tg}"] = int(ytr.sum()); log[f"prior_all_{tg}"] = p_all; log[f"prior_30d_{tg}"] = p_30
            preds = {"prior_all": np.full(len(te), p_all), "prior_30d": np.full(len(te), p_30)}
            for name in MODELS:
                preds[name] = (fit_predict(name, X.loc[tr], ytr, X.loc[te]) if ytr.sum() >= MIN_POS
                               else np.full(len(te), p_30))
            for name, p in preds.items():
                rows.append(pd.DataFrame({"note_id": df.loc[te, "note_id"].values, "tweet_id": df.loc[te, "tweet_id"].values,
                                          "submitted_at": df.loc[te, "when"].array, "refit_day": D, "scored": scored,
                                          "n_train": len(tr), "forecaster": name, "target": tg,
                                          "y": df.loc[te, tg].values, "p": p, "recal_active": False}))
        daylog.append(log)
    pred = pd.concat(rows, ignore_index=True)

    # Platt recalibration, also under the label lag: on day D the recalibrator sees only earlier
    # walk-forward predictions (burn-in or scored) for notes submitted before D - 7 days.
    rec = []
    for (name, tg), g in pred[pred["forecaster"].isin(MODELS)].groupby(["forecaster", "target"]):
        for D, gd in g.groupby("refit_day"):
            past = g[g["submitted_at"] < D - LAG]
            out = gd.copy()
            out["forecaster"] = name + "_platt"
            if len(past) >= PLATT_MIN_N and past["y"].sum() >= PLATT_MIN_POS:
                m = LogisticRegression(C=PLATT_C, max_iter=1000).fit(logit(past["p"].values).reshape(-1, 1), past["y"].values)
                out["p"] = m.predict_proba(logit(gd["p"].values).reshape(-1, 1))[:, 1]
                out["recal_active"] = True
            rec.append(out)
    pred = pd.concat([pred] + rec, ignore_index=True)
    pred.to_parquet(OUT / "predictions.parquet")

    sc = pred[pred["scored"]]
    base = sc[(sc["forecaster"] == "prior_30d")]
    run_meta = {
        "pulled_at_utc": str(pulled_at), "maturity_cutoff_utc": str(cutoff), "n_matured_window_notes": int(len(df)),
        "scored_first_day": str(sc["refit_day"].min().date()), "scored_last_submit": str(sc["submitted_at"].max()),
        "scored_first_submit": str(sc["submitted_at"].min()),
        "n_scored": int(base[base["target"] == "H"]["note_id"].nunique()),
        "positives": {tg: int(base[base["target"] == tg]["y"].sum()) for tg in TARGETS},
        "n_burn_in_unscored": int(pred[(~pred["scored"]) & (pred["forecaster"] == "prior_30d") & (pred["target"] == "H")]["note_id"].nunique()),
        "feature_missing_in_scored": {c: int(X.loc[df["note_id"].isin(base["note_id"]), c].isna().sum()) for c in ["age_h", "eval_score"]},
        "settings": dict(lag_days=7, min_train_scored=MIN_TRAIN_SCORED, min_train_burn=MIN_TRAIN_BURN, min_pos=MIN_POS,
                         prior_window_days=30, prior_shrink_m=PRIOR_SHRINK_M, logit_C=LOGIT_C, gbm=GBM,
                         platt=dict(min_n=PLATT_MIN_N, min_pos=PLATT_MIN_POS, C=PLATT_C), clip=CLIP),
        "features": FEATS, "days": daylog,
    }
    (OUT / "run_meta.json").write_text(json.dumps(run_meta, indent=2, default=float))
    print(json.dumps({k: v for k, v in run_meta.items() if k not in ("days", "features", "settings")}, indent=2))
    print(pd.DataFrame(daylog).to_string())
    print(pred[pred["scored"]].groupby(["forecaster", "target"]).size().unstack())


if __name__ == "__main__":
    main()
