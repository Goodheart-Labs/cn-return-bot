# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""A sigmoid in log time fitted to all of a post's readings so far (GOO-844).

At the decision, the post's readings since it entered the feed are known, plus
(0, 0) at posting, which the curve meets by itself. All three parameters of
V(t) = L / (1 + (c / t)^k) are fitted to them, with a prior that pulls the
steepness k and the half-way age c towards their typical values from the
training posts' whole curves. The prior matters when the readings are few or
cover only a short stretch, so that they cannot say where the curve flattens.

    uv run src/scripts_jim/2026_11_21_feed_views_model/sigmoid_history.py
"""

import warnings

import numpy as np
import pandas as pd
from scipy.optimize import least_squares
from sklearn.ensemble import HistGradientBoostingRegressor

import evaluate as ev
import sigmoid_two_points as s2
import ten_minutes as tm

DECISION_AGES_H = [2, 3, 6, 12, 24]
# How strongly the prior pulls, as the number of readings it is worth.
PRIOR_WEIGHTS = [0.5, 2, 8]


def fit_prior(series: dict, test_ids: set) -> tuple[float, float, float, float]:
    fits = []
    for tid, (posted_at, ages, imps, *_rest) in series.items():
        if tid in test_ids or ages[0] > 6:
            continue
        f = s2.fit_whole_curve(ages, imps)
        if f:
            fits.append(f)
    fits = pd.DataFrame(fits)
    lk, lc = np.log(fits.k), np.log(fits.c)
    return float(lk.mean()), float(lk.std()), float(lc.mean()), float(lc.std())


def predict_v48(ages: np.ndarray, imps: np.ndarray, a: float, prior, weight: float) -> float:
    mk, sk, mc, sc = prior
    keep = (ages <= a + 1e-9) & (imps > 0)
    t, v = ages[keep], np.log(imps[keep])
    now = imps[keep][-1]

    def residuals(p):
        log_l, log_c, log_k = p
        fit = log_l - np.log1p((np.exp(log_c) / t) ** np.exp(log_k))
        # The readings are noisy by a few percent, so each counts with that scale.
        return np.concatenate([(fit - v) / 0.03, np.sqrt(weight) * np.array([(log_k - mk) / sk, (log_c - mc) / sc])])

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        p0 = [np.log(now * 2), mc, mk]
        res = least_squares(residuals, p0, bounds=([np.log(now), np.log(0.01), np.log(0.05)], [np.log(now * 1e3), np.log(1e4), np.log(10)]))
    log_l, log_c, log_k = res.x
    return float(np.exp(log_l - np.log1p((np.exp(log_c) / 48) ** np.exp(log_k))))


def main() -> None:
    views, profiles = ev.load()
    series = ev.series_by_post(views, profiles.author_followers)
    test_ids = {t for t in series if ev.is_test_post(t)}
    prior = fit_prior(series, test_ids)
    print(f"prior: k typical {np.exp(prior[0]):.2f} (log sd {prior[1]:.2f}), c typical {np.exp(prior[2]):.1f} h (log sd {prior[3]:.2f})")
    train = tm.examples_at(series, [(t, a, {}) for t in series if t not in test_ids for a in tm.HALF_HOUR_STEPS_H])
    trees = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=0).fit(tm.features(train), np.log1p(train.to_come))
    test = tm.examples_at(series, [(t, a, {}) for t in test_ids for a in DECISION_AGES_H])
    for a in DECISION_AGES_H:
        part = test[test.age == a]
        true = part.to_come.values
        print(f"\nage {a} h: {len(part)} test posts")
        rows = {"boosted trees, 10 minutes": np.expm1(trees.predict(tm.features(part)))}
        for w in PRIOR_WEIGHTS:
            pred = [predict_v48(series[r.tweet_id][1], series[r.tweet_id][2], r.age, prior, w) - r.now for r in part.itertuples()]
            rows[f"sigmoid on all readings, prior {w}"] = np.clip(np.array(pred), 0, None)
        for name, p in rows.items():
            m = ev.metrics(true, p)
            print(f"  {name:36s} typical error x{m['median_error']:.2f}  within 2x {m['within_2x']:.0%}")


if __name__ == "__main__":
    main()
