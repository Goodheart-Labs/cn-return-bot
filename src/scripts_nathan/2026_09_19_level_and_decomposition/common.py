# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""Shared scaffolding for the level / decomposition study (2026-09-19).

OFFLINE. Reads only the parquet files pulled by ../2026_09_18_outcome_screen/pull.py,
reusing that folder's load() and build() for the joins (read-only import). No database,
no LLM, no external API. Nothing here writes to a sibling folder.

Walk-forward rule, identical to ../2026_09_18_forecast_baselines/forecast.py:
one refit per UTC calendar day D of submit time; a fit made on day D may only use
labels of notes submitted before D - 7 days. Every note submitted during day D is
predicted by that day's fit.

=======================  PRE-REGISTRATION (written before any result was computed)
HALF_LIVES = [7, 14, 30, 60] days.  All four are reported.

SELECTION RULE for the headline EWMA half-life (fixed once, at the start of the test
period, never revisited): lowest Brier for target H over SELECT_SET = every row of the
`notes` table submitted 2026-07-01 00:00 UTC <= t < 2026-08-16 00:00 UTC.  That set is
exactly the recent-regime history whose labels had resolved by the first scored refit
day (2026-08-23), so the choice uses no test-period information.  Ties -> longer
half-life.  A robustness check on a narrower selection set (window notes submitted
2026-08-07 to 2026-08-15) is reported alongside and is NOT the headline.

LOCAL LINEAR TREND variances are estimated by maximum likelihood on the same training
period (daily series of days strictly before 2026-08-16) and then held FIXED for the
whole walk-forward.

CONDITIONAL-FACTOR SHRINKAGE for P(H | rated): level shrunk to the all-history
conditional rate with COND_SHRINK_M = 100 pseudo-notes (sensitivities at 50 and 200
also reported); feature slopes shrunk by lambda = n_rated / (n_rated + 200).
============================================================================
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import brentq, minimize
from sklearn.linear_model import LogisticRegression

sys.dont_write_bytecode = True  # never touch the sibling folder's __pycache__
HERE = Path(__file__).resolve().parent
SCREEN = HERE.parent / "2026_09_18_outcome_screen"
BASE = HERE.parent / "2026_09_18_forecast_baselines"
sys.path.insert(0, str(SCREEN))
from screen import load, build  # noqa: E402  (read-only reuse of the joins)

OUT = HERE / "data"
LAG = pd.Timedelta(days=7)
TARGETS = ["H", "NH", "rated"]
CLIP = (0.001, 0.999)
PRED_CLIP = (1e-5, 1 - 1e-5)

# --- copied verbatim from the prior backtest so the scored set is identical ---
MIN_TRAIN_SCORED = 400
MIN_TRAIN_BURN = 100
MIN_POS = 5
PRIOR_WINDOW = pd.Timedelta(days=30)
PRIOR_SHRINK_M = 50
LOGIT_C = 1.0
STABLE4 = ["has_earlier", "age_h", "feed_missing", "hist_noH", "hist_H", "eval_score", "eval_missing"]
CONT = ["age_h", "eval_score"]

# --- new settings, all pre-registered above ---
HALF_LIVES = [7, 14, 30, 60]
SELECT_START = pd.Timestamp("2026-07-01", tz="UTC")
SELECT_END = pd.Timestamp("2026-08-16", tz="UTC")          # = first scored refit day - 7d
NARROW_START = pd.Timestamp("2026-08-07", tz="UTC")        # robustness check only
LLT_TRAIN_END = SELECT_END
LLT_P0 = 1e6
LLT_DIFFUSE_SKIP = 2
COND_SHRINK_M = 100
COND_SHRINK_SENS = [50, 200]
COND_LAMBDA_K = 200
COND_C = 0.1                                               # heavier L2 than the one-stage C=1.0


# ---------------------------------------------------------------- features
def features(df):
    """stable4 feature block, identical to the prior backtest's definition."""
    X = pd.DataFrame(index=df.index)
    feed = df["has_feed"].values
    X["has_earlier"] = (df["n_before"] >= 1).astype(float)
    hrs = (df["feed_first_seen_at"] - df["posted_at"]).dt.total_seconds() / 3600
    X["age_h"] = hrs.clip(lower=0, upper=48)
    X["feed_missing"] = (~df["has_feed"]).astype(float)
    X["hist_noH"] = ((df["n_prior"] > 0) & (df["n_prior_H"] == 0)).astype(float)
    X["hist_H"] = (df["n_prior_H"] > 0).astype(float)
    X["eval_score"] = df["eval_score"]
    X["eval_missing"] = df["eval_score"].isna().astype(float)
    X.loc[~feed, ["age_h"]] = np.nan
    return X


def prep(Xtr, Xte, cols, cont=None):
    """Training-only imputation and scaling. Returns (Xtr, Xte) as float arrays.
    `cont` names the columns to standardise; it defaults to CONT, and the materiality
    addendum passes its own list so `mat_overall` (range about 0.85 to 0.95) is scaled
    rather than being crushed by the L2 penalty."""
    cont = CONT if cont is None else cont
    a, b = Xtr[cols].copy(), Xte[cols].copy()
    med = a.median().fillna(0.0)
    a, b = a.fillna(med), b.fillna(med)
    for c in [c for c in cols if c in cont]:
        mu, sd = a[c].mean(), a[c].std()
        sd = sd if sd > 0 else 1.0
        a[c], b[c] = (a[c] - mu) / sd, (b[c] - mu) / sd
    return a.values, b.values


def logit(p):
    p = np.clip(p, *CLIP)
    return np.log(p / (1 - p))


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -50, 50)))


def swap_level(eta_tr, eta_te, level):
    """Keep the slopes, replace the intercept: shift every logit by the constant delta
    that makes the mean fitted probability over the TRAINING rows equal `level`.
    Uses training features only, so it leaks nothing from the test day."""
    level = float(np.clip(level, 1e-6, 1 - 1e-6))

    def f(d):
        return sigmoid(eta_tr + d).mean() - level

    lo, hi = -40.0, 40.0
    if f(lo) > 0 or f(hi) < 0:
        return sigmoid(eta_te + (logit(level) - logit(sigmoid(eta_tr).mean())))
    d = brentq(f, lo, hi, xtol=1e-10)
    return sigmoid(eta_te + d)


# ---------------------------------------------------------------- level estimators
def shrunk_mean(k, n, prior, m):
    return (k + m * prior) / (n + m)


def ewma_level(when, y, horizon, half_life, prior, m=PRIOR_SHRINK_M):
    """Exponentially weighted mean of the outcome, i.e. the MLE of an intercept-only
    weighted logistic regression with weights 2^(-age/half_life), shrunk to `prior` by
    m pseudo-notes.  NOTE: implemented as a weighted mean on the probability scale and
    then read off as a logit, NOT as an average of daily logits: averaging daily logits
    is a geometric-odds mean and is biased downwards by Jensen whenever the daily rates
    are dispersed, which would flatter a forecaster whose job is to track a falling
    level.  Only this definition was run."""
    age = (horizon - when).dt.total_seconds().values / 86400.0
    w = np.power(2.0, -age / half_life)
    return (float((w * y).sum()) + m * prior) / (float(w.sum()) + m)


def daily_counts(when, y):
    """(day, n, k) for the outcome, one row per UTC day that has at least one note."""
    d = pd.DataFrame({"day": when.dt.floor("D"), "y": y})
    g = d.groupby("day")["y"].agg(["size", "sum"])
    return g.index, g["size"].values.astype(float), g["sum"].values.astype(float)


def _series(days, n, k):
    """Regular daily grid with Haldane-corrected empirical logits and their variances."""
    days = pd.DatetimeIndex(days)
    grid = pd.date_range(days.min(), days.max(), freq="D")
    idx = pd.Series(np.arange(len(days)), index=days).reindex(grid)
    obs = idx.notna().values
    y = np.full(len(grid), np.nan)
    v = np.full(len(grid), np.nan)
    j = idx.dropna().astype(int).values
    kk, nn = k[j], n[j]
    y[obs] = np.log((kk + 0.5) / (nn - kk + 0.5))
    v[obs] = 1.0 / (kk + 0.5) + 1.0 / (nn - kk + 0.5)
    return grid, y, v, obs


def llt_filter(y, v, obs, q_lvl, q_slp, a0, p0=LLT_P0, skip=LLT_DIFFUSE_SKIP):
    """Kalman filter for a local level + slope model on the daily logit series.
    Diffuse prior: P0 = p0 * I, and the first `skip` observations are left out of the
    likelihood (the usual diffuse-likelihood correction). Missing days are prediction
    steps only. Returns (diffuse log-likelihood, final state, final covariance)."""
    T = np.array([[1.0, 1.0], [0.0, 1.0]])
    Q = np.diag([q_lvl, q_slp])
    a = np.asarray(a0, dtype=float).copy()
    P = np.eye(2) * p0
    ll, seen = 0.0, 0
    for i in range(len(y)):
        if i > 0:
            a = T @ a
            P = T @ P @ T.T + Q
        if obs[i]:
            F = P[0, 0] + v[i]
            e = y[i] - a[0]
            K = P[:, 0] / F
            seen += 1
            if seen > skip:
                ll += -0.5 * (np.log(2 * np.pi * F) + e * e / F)
            a = a + K * e
            P = P - np.outer(K, P[0, :])
    return ll, a, P


def llt_fit(y, v, obs, a0):
    """MLE of the two state variances on the training series. Nelder-Mead in log10."""
    def nll(theta):
        q = np.power(10.0, np.clip(theta, -10, 2))
        ll, _, _ = llt_filter(y, v, obs, q[0], q[1], a0)
        return -ll if np.isfinite(ll) else 1e12

    best = None
    for start in [(-3.0, -5.0), (-2.0, -4.0), (-4.0, -6.0)]:
        r = minimize(nll, np.array(start), method="Nelder-Mead",
                     options=dict(xatol=1e-4, fatol=1e-4, maxiter=2000))
        if best is None or r.fun < best.fun:
            best = r
    q = np.power(10.0, np.clip(best.x, -10, 2))
    return float(q[0]), float(q[1]), float(-best.fun)


def smooth_trend_fit(y, v, obs, a0):
    """Integrated random walk ('smooth trend'): level noise switched off, only the slope
    innovates. Added because the unrestricted local-linear-trend MLE put the slope
    variance on the zero boundary ON THE TRAINING SERIES; this variant forces the model
    to carry a moving trend and is still fitted on training data only. One-dimensional
    MLE over q_slope with q_level = 0."""
    def nll(theta):
        q = float(np.power(10.0, np.clip(theta[0], -12, 2)))
        ll, _, _ = llt_filter(y, v, obs, 0.0, q, a0)
        return -ll if np.isfinite(ll) else 1e12

    best = None
    for start in [-5.0, -4.0, -6.0, -7.0]:
        r = minimize(nll, np.array([start]), method="Nelder-Mead",
                     options=dict(xatol=1e-4, fatol=1e-4, maxiter=2000))
        if best is None or r.fun < best.fun:
            best = r
    return 0.0, float(np.power(10.0, np.clip(best.x[0], -12, 2))), float(-best.fun)


def llt_forecast(days, n, k, horizon, D, q_lvl, q_slp, a0):
    """Filter the daily logit series up to `horizon`, then extrapolate the level by the
    slope out to day D (about 8 days, the 30-day-window lag is what we are undoing)."""
    days = pd.DatetimeIndex(days)
    m = np.asarray(days < horizon)
    if m.sum() < 10:
        return np.nan, np.nan, np.nan, 0
    grid, y, v, obs = _series(days[m], n[m], k[m])
    _, a, _ = llt_filter(y, v, obs, q_lvl, q_slp, a0)
    steps = int((D - grid[-1]) / pd.Timedelta(days=1))
    return float(sigmoid(a[0] + steps * a[1])), float(a[0]), float(a[1]), steps


# ---------------------------------------------------------------- walk-forward scaffold
def schedule(df):
    """Yield (D, horizon, test index, train index, scored) exactly as the prior run did."""
    days = pd.date_range(df["when"].min().floor("D"), df["when"].max().floor("D"), freq="D")
    for D in days:
        horizon = D - LAG
        te = df.index[(df["when"] >= D) & (df["when"] < D + pd.Timedelta(days=1))]
        tr = df.index[df["when"] < horizon]
        if len(te) == 0 or len(tr) < MIN_TRAIN_BURN:
            continue
        yield D, horizon, te, tr, len(tr) >= MIN_TRAIN_SCORED


def fit_logit(Xtr, ytr, Xte, C=LOGIT_C):
    """Returns (p_test, eta_train, eta_test)."""
    m = LogisticRegression(C=C, max_iter=1000).fit(Xtr, ytr)
    return m.predict_proba(Xte)[:, 1], m.decision_function(Xtr), m.decision_function(Xte), m


def get_data():
    meta, pulled_at, cutoff, t = load()
    notes_all, _, df = build(t, cutoff)
    df = df.sort_values("when").reset_index(drop=True)
    assert df["note_id"].is_unique
    hist = notes_all[["when", "H", "NH", "rated"]].dropna(subset=["when"]).sort_values("when").reset_index(drop=True)
    return meta, pulled_at, cutoff, notes_all, df, hist


def write_json(path, obj):
    path.write_text(json.dumps(obj, indent=2, default=float))
