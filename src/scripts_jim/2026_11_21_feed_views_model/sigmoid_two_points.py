# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""A sigmoid in log time from two readings (GOO-844).

The curve V(t) = L / (1 + (c / t)^k) has three parameters: the final views L,
the half-way age c and the steepness k. It passes through (0, 0) by itself.
Two readings, the views now and the views 10 minutes ago, give two equations,
which is one too few. So the steepness k is shared by all posts and learned from
the complete curves of the training posts. Then each post's own L and c follow
in closed form from its elasticity e, its relative growth over the last 10
minutes divided by its relative growth in age:

    e = k (1 - V / L)   so   L = V / (1 - e / k)
    (c / t)^k = L / V - 1,   and V(48) = L / (1 + (L / V - 1) (t / 48)^k)

1. How well does the sigmoid fit a whole curve, with all readings known?
2. What k do the training posts have?
3. How well does the two-reading prediction do, against the trees and velocity?

    uv run src/scripts_jim/2026_11_21_feed_views_model/sigmoid_two_points.py
"""

import warnings

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor

import evaluate as ev
import ten_minutes as tm

FULL_AGE_H = 48
# e must stay below k, or L is infinite. A post growing at its limit is
# treated as if e were this share of k.
MAX_E_OVER_K = 0.95
DECISION_AGES_H = [1, 2, 3, 6, 12, 24]


def log_logistic(t, log_l, log_c, k):
    return log_l - np.log1p((np.exp(log_c) / t) ** k)


def fit_whole_curve(ages: np.ndarray, imps: np.ndarray):
    """Fits all readings up to 48 hours, plus (0, 0) which the curve meets anyway."""
    keep = (ages <= FULL_AGE_H) & (imps > 0)
    t, v = ages[keep], imps[keep]
    if len(t) < 10:
        return None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            p, _ = curve_fit(log_logistic, t, np.log(v), p0=[np.log(v[-1] * 1.2), np.log(max(t[0], 0.5)), 1.0],
                             bounds=([np.log(v[-1] * 0.5), np.log(0.01), 0.05], [np.log(v[-1] * 100), np.log(1e4), 10]), maxfev=5000)
    except (RuntimeError, ValueError):
        return None
    err = np.abs(log_logistic(t, *p) - np.log(v))
    return {"k": p[2], "c": np.exp(p[1]), "L": np.exp(p[0]), "median_err": float(np.median(err)), "max_err": float(err.max())}


def two_point_v48(now: np.ndarray, before: np.ndarray, age: np.ndarray, k: float) -> np.ndarray:
    dt = 1 / 6
    with np.errstate(divide="ignore", invalid="ignore"):
        e = np.log(np.maximum(now, 1) / np.maximum(before, 1)) / np.log(age / np.maximum(age - dt, 1e-3))
    e = np.clip(np.nan_to_num(e, nan=0.0), 0, MAX_E_OVER_K * k)
    L = now / (1 - e / k)
    return L / (1 + (L / np.maximum(now, 1) - 1) * (age / FULL_AGE_H) ** k)


def main() -> None:
    views, profiles = ev.load()
    series = ev.series_by_post(views, profiles.author_followers)
    test_ids = {t for t in series if ev.is_test_post(t)}

    # 1 and 2: whole-curve fits of the training posts seen from early on.
    fits = []
    for tid, (posted_at, ages, imps, *_rest) in series.items():
        if tid in test_ids or ages[0] > 6:
            continue
        f = fit_whole_curve(ages, imps)
        if f:
            fits.append(f)
    fits = pd.DataFrame(fits)
    print(f"Whole-curve fits of {len(fits):,} training posts first seen by 6 h old:")
    print(f"  typical error per reading: median over posts x{np.exp(fits.median_err.median()):.3f}, 90th percentile x{np.exp(fits.median_err.quantile(.9)):.3f}")
    print(f"  worst reading per post: median x{np.exp(fits.max_err.median()):.2f}")
    print(f"  k: quartiles {np.round(fits.k.quantile([.25, .5, .75]).values, 2)}, half-way age c: quartiles {np.round(fits.c.quantile([.25, .5, .75]).values, 1)} h")

    # Choose the shared k on the training posts' decisions.
    train = tm.examples_at(series, [(t, a, {}) for t in series if t not in test_ids for a in tm.HALF_HOUR_STEPS_H])
    ks = np.round(np.arange(0.3, 3.01, 0.05), 2)
    errs = [np.median(np.abs(np.log1p(np.clip(two_point_v48(train.now.values, train.ten.values, train.age.values, k) - train.now.values, 0, None)) - np.log1p(train.to_come.values))) for k in ks]
    k_best = float(ks[int(np.argmin(errs))])
    print(f"\nShared k that fits the training decisions best: {k_best} (the median of the whole-curve fits is {fits.k.median():.2f})")

    trees = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=0).fit(tm.features(train), np.log1p(train.to_come))

    # 3a: fixed ages.
    test = tm.examples_at(series, [(t, a, {}) for t in test_ids for a in DECISION_AGES_H])
    for a in DECISION_AGES_H:
        part = test[test.age == a]
        if len(part) < tm.ev.MIN_TEST_POSTS:
            print(f"\nage {a} h: only {len(part)} test posts")
            continue
        true = part.to_come.values
        preds = {
            "velocity": part.now / part.age * (FULL_AGE_H - part.age),
            "sigmoid, shared k": two_point_v48(part.now.values, part.ten.values, part.age.values, k_best) - part.now.values,
            "boosted trees, 10 minutes": np.expm1(trees.predict(tm.features(part))),
        }
        print(f"\nage {a} h: {len(part)} test posts")
        for name, p in preds.items():
            m = ev.metrics(true, np.asarray(p, dtype=float))
            print(f"  {name:28s} typical error x{m['median_error']:.2f}  within 2x {m['within_2x']:.0%}")

    # 3b: the ranking at moments.
    test_series = {t: series[t] for t in test_ids}
    first = min(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MAX_AGE_H)
    last = max(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MIN_AGE_H)
    moments = [(tid, (t - v[0]).total_seconds() / 3600, {"snapshot": k}) for k, t in enumerate(pd.date_range(first, last, freq="1h"))
               for tid, v in test_series.items() if 0.25 <= (t - v[0]).total_seconds() / 3600 <= ev.SNAPSHOT_MAX_AGE_H]
    ex = tm.examples_at(series, moments)
    print(f"\nRanking at {ex.snapshot.nunique()} moments, {len(ex) / ex.snapshot.nunique():.0f} posts each:")
    for name, p in {
        "velocity (production order)": ex.now / ex.age,
        "last 10 minutes' growth": ex.now - ex.ten,
        "sigmoid, shared k": two_point_v48(ex.now.values, ex.ten.values, ex.age.values, k_best) - ex.now.values,
        "boosted trees, 10 minutes": np.expm1(trees.predict(tm.features(ex))),
    }.items():
        tm.score(name, ex, np.asarray(p, dtype=float))


if __name__ == "__main__":
    main()
