# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""Jim's cutoff models (GOO-844, 2026-11-23).

The rate is the views gained in the last 10 minutes times 6, in views per hour.
Views still to come count until the post is 48 hours old, so a linear phase is
cut off at 48 hours.

v1  A post younger than 24 h grows at the rate until it is 24 h old, then stays
    flat. A post older than 24 h grows at the rate for as long again as it is
    past 24 h.
v2  Four learned numbers: the cutoff T instead of 24, a factor m on the length
    of the full-speed phase, m x |T - age|, and the share of the rate the post
    keeps after that phase until 48 h: x_young for posts younger than T and
    x_old for posts older than T. v1 is v2 with T = 24, m = 1, x = 0.
v3  A smooth v2: the speed fades exponentially from the rate down to x times
    the rate, over a span D = m sqrt((age - T)^2 + s^2), a V shape rounded off
    near T. x moves from x_young to x_old in a logistic step around T of width s.

    uv run src/scripts_jim/2026_11_21_feed_views_model/jim_cutoff_models.py
"""

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit
from sklearn.ensemble import HistGradientBoostingRegressor

import evaluate as ev
import simple_formulas as sf
import ten_minutes as tm

T_END = 48.0


def v2_hours(a, p):
    T, m, x_young, x_old = p
    left = T_END - a
    full = np.minimum(m * np.abs(T - a), left)
    x = np.where(a < T, x_young, x_old)
    return full + x * (left - full)


def v1_hours(a, _p=None):
    return v2_hours(a, [24.0, 1.0, 0.0, 0.0])


def v3_hours(a, p):
    T, m, x_young, x_old, s = p
    s = abs(s) + 1e-3
    left = T_END - a
    D = np.maximum(m * np.sqrt((a - T) ** 2 + s**2), 1e-3)
    x = x_young + (x_old - x_young) * expit((a - T) / s)
    return x * left + (1 - x) * D * (1 - np.exp(-left / D))


def fit(train: pd.DataFrame, shape, starts):
    r, a, y = sf.rate(train), train.age.to_numpy(), np.log1p(train.to_come.to_numpy())

    def loss(p):
        return np.mean((np.log1p(r * np.maximum(shape(a, p), 0)) - y) ** 2)

    best = min((minimize(loss, p0, method="Nelder-Mead", options={"maxiter": 4000, "xatol": 1e-4, "fatol": 1e-9}) for p0 in starts), key=lambda res: res.fun)
    return best.x, best.fun


def main() -> None:
    views, profiles = ev.load()
    series = ev.series_by_post(views, profiles.author_followers)
    test_ids = {t for t in series if ev.is_test_post(t)}
    train = tm.examples_at(series, [(t, a, {}) for t in series if t not in test_ids for a in tm.HALF_HOUR_STEPS_H])

    r, a, y = sf.rate(train), train.age.to_numpy(), np.log1p(train.to_come.to_numpy())
    v1_loss = np.mean((np.log1p(r * v1_hours(a)) - y) ** 2)
    p2, l2 = fit(train, v2_hours, [[24, 1, 0.1, 0.1], [12, 1, 0.2, 0.3], [8, 0.5, 0.2, 0.5], [30, 2, 0.1, 0.5]])
    p3, l3 = fit(train, v3_hours, [[24, 1, 0.1, 0.1, 2], [12, 1, 0.2, 0.3, 4], [8, 0.5, 0.2, 0.5, 2], [10, 1, 0.1, 0.5, 6]])
    tau = sf.fit(train, sf.halving_hours, [6.0])
    print(f"training loss (mean squared log error): v1 {v1_loss:.3f}, v2 {l2:.3f}, v3 {l3:.3f}")
    print(f"v2: T = {p2[0]:.1f} h, m = {p2[1]:.2f}, x_young = {p2[2]:.2f}, x_old = {p2[3]:.2f}")
    print(f"v3: T = {p3[0]:.1f} h, m = {p3[1]:.2f}, x_young = {p3[2]:.2f}, x_old = {p3[3]:.2f}, s = {abs(p3[4]):.1f} h")
    print("effective hours left by age:")
    for age in [1, 3, 6, 9, 12, 18, 24, 30, 36]:
        print(f"  {age:2d} h: v1 {v1_hours(np.array([age]))[0]:5.1f}  v2 {v2_hours(np.array([age]), p2)[0]:5.1f}  v3 {v3_hours(np.array([age]), p3)[0]:5.1f}  halving {sf.halving_hours(age, tau):5.1f}")

    trees = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=0).fit(tm.features(train), np.log1p(train.to_come))

    def predictions(ex):
        r, a = sf.rate(ex), ex.age.to_numpy()
        return {
            "v1": r * v1_hours(a),
            "v2": r * v2_hours(a, p2),
            "v3": r * v3_hours(a, p3),
            "speed halving every 8.4 h": r * sf.halving_hours(a, tau),
            "boosted trees, 10 minutes": np.expm1(trees.predict(tm.features(ex))),
        }

    test = tm.examples_at(series, [(t, a, {}) for t in test_ids for a in sf.DECISION_AGES_H])
    for age in sf.DECISION_AGES_H:
        part = test[test.age == age]
        print(f"\nage {age} h: {len(part)} test posts")
        for name, p in predictions(part).items():
            m = ev.metrics(part.to_come.to_numpy(), np.asarray(p, dtype=float))
            print(f"  {name:28s} typical error x{m['median_error']:.2f}  within 2x {m['within_2x']:.0%}")

    test_series = {t: series[t] for t in test_ids}
    first = min(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MAX_AGE_H)
    last = max(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MIN_AGE_H)
    moments = [(tid, (t - v[0]).total_seconds() / 3600, {"snapshot": k}) for k, t in enumerate(pd.date_range(first, last, freq="1h"))
               for tid, v in test_series.items() if 0.25 <= (t - v[0]).total_seconds() / 3600 <= ev.SNAPSHOT_MAX_AGE_H]
    ex = tm.examples_at(series, moments)
    print(f"\nRanking at {ex.snapshot.nunique()} moments, {len(ex) / ex.snapshot.nunique():.0f} posts each:")
    for name, p in predictions(ex).items():
        tm.score(name, ex, np.asarray(p, dtype=float))


if __name__ == "__main__":
    main()
