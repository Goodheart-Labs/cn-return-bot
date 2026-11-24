# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""Simple formulas from the 10-minute gain and the age (GOO-844).

Jim's observation: at equal views gained in the last 10 minutes, a younger post
does better, and the 10-minute gain carries most of the signal. So every
formula here is

    views still to come = rate now x effective hours left(age)

where the rate now is the 10-minute gain times 6, in views per hour, and the
effective hours left depend only on the age. Parameters are fitted on the
training posts by least squares on log(1 + views still to come).

    uv run src/scripts_jim/2026_11_21_feed_views_model/simple_formulas.py
"""

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.ensemble import HistGradientBoostingRegressor

import evaluate as ev
import ten_minutes as tm

T_END = 48.0
DECISION_AGES_H = [2, 3, 6, 12, 24]
LOOKUP_STEP_H = 1


def rate(ex: pd.DataFrame) -> np.ndarray:
    return np.clip((ex.now - ex.ten).to_numpy(), 0, None) * 6


def hours_until_48(a, _p):
    return T_END - a


def power_decay_hours(a, p):
    """The rate falls as t^-k from now on: the integral of (a / t)^k from a to 48."""
    k = p[0]
    if abs(k - 1) < 1e-6:
        return a * np.log(T_END / a)
    return a / (1 - k) * ((T_END / a) ** (1 - k) - 1)


def halving_hours(a, p):
    """The rate halves every tau hours."""
    tau = p[0]
    lam = np.log(2) / tau
    return (1 - np.exp(-lam * (T_END - a))) / lam


def fit(train: pd.DataFrame, shape, p0, damped: bool = False):
    r, a, y = rate(train), train.age.to_numpy(), np.log1p(train.to_come.to_numpy())

    def loss(p):
        beta = p[-1] if damped else 1.0
        c = p[-2] if damped else 0.0
        pred = np.log1p(np.exp(c) * r**beta * np.maximum(shape(a, p), 0))
        return np.mean((pred - y) ** 2)

    res = minimize(loss, p0, method="Nelder-Mead", options={"maxiter": 2000, "xatol": 1e-4, "fatol": 1e-8})
    return res.x


class Lookup:
    """The typical effective hours left per hour of age: the median of views to
    come divided by the rate now, among training examples of that age."""

    def fit(self, train: pd.DataFrame):
        r = rate(train)
        ok = r > 0
        ratio = train.to_come.to_numpy()[ok] / r[ok]
        bins = np.floor(train.age.to_numpy()[ok] / LOOKUP_STEP_H).astype(int)
        self.table = pd.Series(ratio).groupby(bins).median()
        return self

    def hours(self, a):
        idx = np.clip(np.floor(np.asarray(a) / LOOKUP_STEP_H).astype(int), self.table.index.min(), self.table.index.max())
        return self.table.reindex(idx).interpolate().to_numpy()


def main() -> None:
    views, profiles = ev.load()
    series = ev.series_by_post(views, profiles.author_followers)
    test_ids = {t for t in series if ev.is_test_post(t)}
    train = tm.examples_at(series, [(t, a, {}) for t in series if t not in test_ids for a in tm.HALF_HOUR_STEPS_H])

    k = fit(train, power_decay_hours, [1.0])
    tau = fit(train, halving_hours, [6.0])
    kd = fit(train, power_decay_hours, [1.0, 0.0, 0.8], damped=True)
    lookup = Lookup().fit(train)
    trees = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=0).fit(tm.features(train), np.log1p(train.to_come))
    print(f"fitted: power decay k = {k[0]:.2f}; halving every {tau[0]:.1f} h; damped: k = {kd[0]:.2f}, scale = {np.exp(kd[1]):.2f}, beta = {kd[2]:.2f}")
    print("effective hours left by age:")
    for a in [1, 2, 3, 6, 12, 24, 36]:
        print(f"  {a:2d} h: until 48 h {T_END - a:4.0f}, power decay {power_decay_hours(a, k):5.1f}, halving {halving_hours(a, tau):5.1f}, lookup {lookup.hours([a])[0]:5.1f}")

    def predictions(ex: pd.DataFrame) -> dict:
        r, a = rate(ex), ex.age.to_numpy()
        return {
            "velocity (production)": ex.now.to_numpy() / a * (T_END - a),
            "rate x hours until 48 h": r * hours_until_48(a, None),
            f"rate x power decay, k {k[0]:.2f}": r * power_decay_hours(a, k),
            f"rate x halving, every {tau[0]:.1f} h": r * halving_hours(a, tau),
            "rate x lookup by age": r * lookup.hours(a),
            f"damped: {np.exp(kd[1]):.2f} rate^{kd[2]:.2f} x power decay, k {kd[0]:.2f}": np.exp(kd[1]) * r ** kd[2] * power_decay_hours(a, kd),
            "boosted trees, 10 minutes": np.expm1(trees.predict(tm.features(ex))),
        }

    test = tm.examples_at(series, [(t, a, {}) for t in test_ids for a in DECISION_AGES_H])
    for a in DECISION_AGES_H:
        part = test[test.age == a]
        print(f"\nage {a} h: {len(part)} test posts")
        for name, p in predictions(part).items():
            m = ev.metrics(part.to_come.to_numpy(), np.asarray(p, dtype=float))
            print(f"  {name:48s} typical error x{m['median_error']:.2f}  within 2x {m['within_2x']:.0%}")

    test_series = {t: series[t] for t in test_ids}
    first = min(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MAX_AGE_H)
    last = max(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MIN_AGE_H)
    moments = [(tid, (t - v[0]).total_seconds() / 3600, {"snapshot": k_}) for k_, t in enumerate(pd.date_range(first, last, freq="1h"))
               for tid, v in test_series.items() if 0.25 <= (t - v[0]).total_seconds() / 3600 <= ev.SNAPSHOT_MAX_AGE_H]
    ex = tm.examples_at(series, moments)
    print(f"\nRanking at {ex.snapshot.nunique()} moments, {len(ex) / ex.snapshot.nunique():.0f} posts each:")
    preds = predictions(ex)
    preds["last 10 minutes' growth alone"] = rate(ex)
    for name, p in preds.items():
        tm.score(name, ex, np.asarray(p, dtype=float))


if __name__ == "__main__":
    main()
