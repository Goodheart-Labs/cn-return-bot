# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""A closed-form hump with a dip for the effective hours left (GOO-844).

    views still to come = rate now x H(age)
    H(age) = A (1 - exp(-age / tau1)) (1 - exp(-(48 - age) / tau2)) (1 - d exp(-(age - mu)^2 / (2 w^2)))

The rate now is the 10-minute gain times 6. The first factor is the rise:
very young posts get few hours because their bursts fade. The second is the
fall: fewer hours are left to count near the 48-hour end. The third is a
bell-shaped dip of depth d around the age mu. Fitted on the training posts by
least squares on log(1 + views still to come), with and without the dip.

Writes hump_curve.json for the findings page: the lookup table's median and
middle half per hour of age, and both fitted curves.

    uv run src/scripts_jim/2026_11_21_feed_views_model/hump_formula.py
"""

import json

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

import evaluate as ev
import simple_formulas as sf
import ten_minutes as tm

T_END = 48.0


def hump(a, p):
    A, tau1, tau2 = p[:3]
    return abs(A) * (1 - np.exp(-a / abs(tau1))) * (1 - np.exp(-np.maximum(T_END - a, 0) / abs(tau2)))


def hump_dip(a, p):
    d, mu, w = p[3:]
    return hump(a, p) * (1 - np.clip(d, 0, 0.95) * np.exp(-((a - mu) ** 2) / (2 * w**2)))


def main() -> None:
    views, profiles = ev.load()
    series = ev.series_by_post(views, profiles.author_followers)
    test_ids = {t for t in series if ev.is_test_post(t)}
    train = tm.examples_at(series, [(t, a, {}) for t in series if t not in test_ids for a in tm.HALF_HOUR_STEPS_H])

    p_h = sf.fit(train, hump, [15.0, 4.0, 10.0])
    starts = [[*p_h, 0.4, 24.0, 3.0], [*p_h, 0.3, 22.0, 5.0], [*p_h, 0.5, 26.0, 2.0]]
    fits = [sf.fit(train, hump_dip, s) for s in starts]
    r, a, y = sf.rate(train), train.age.to_numpy(), np.log1p(train.to_come.to_numpy())
    loss = lambda shape, p: np.mean((np.log1p(r * np.maximum(shape(a, p), 0)) - y) ** 2)
    p_hd = min(fits, key=lambda p: loss(hump_dip, p))
    print(f"hump: A = {abs(p_h[0]):.1f} h, tau1 = {abs(p_h[1]):.2f} h, tau2 = {abs(p_h[2]):.1f} h  (train loss {loss(hump, p_h):.3f})")
    print(f"hump with dip: A = {abs(p_hd[0]):.1f} h, tau1 = {abs(p_hd[1]):.2f} h, tau2 = {abs(p_hd[2]):.1f} h, d = {np.clip(p_hd[3], 0, .95):.2f}, mu = {p_hd[4]:.1f} h, w = {abs(p_hd[5]):.1f} h  (train loss {loss(hump_dip, p_hd):.3f})")

    lookup = sf.Lookup().fit(train)
    tau = sf.fit(train, sf.halving_hours, [6.0])
    trees = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=0).fit(tm.features(train), np.log1p(train.to_come))

    def predictions(ex):
        r, a = sf.rate(ex), ex.age.to_numpy()
        return {
            "speed halving every 8.4 h": r * sf.halving_hours(a, tau),
            "hump": r * hump(a, p_h),
            "hump with dip": r * hump_dip(a, p_hd),
            "lookup table": r * lookup.hours(a),
            "boosted trees, 10 minutes": np.expm1(trees.predict(tm.features(ex))),
        }

    results = {"hump": [abs(v) for v in p_h], "hump_dip": [abs(p_hd[0]), abs(p_hd[1]), abs(p_hd[2]), float(np.clip(p_hd[3], 0, .95)), float(p_hd[4]), abs(p_hd[5])], "ages": {}}
    test = tm.examples_at(series, [(t, a, {}) for t in test_ids for a in sf.DECISION_AGES_H])
    for age in sf.DECISION_AGES_H:
        part = test[test.age == age]
        print(f"\nage {age} h: {len(part)} test posts")
        results["ages"][age] = {}
        for name, p in predictions(part).items():
            m = ev.metrics(part.to_come.to_numpy(), np.asarray(p, dtype=float))
            results["ages"][age][name] = m["median_error"]
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

    # The curve for the page: the lookup per hour of age with its middle half, and the two fits.
    rr = sf.rate(train)
    ok = rr > 0
    df = pd.DataFrame({"age": np.floor(train.age.to_numpy()[ok]).astype(int), "ratio": train.to_come.to_numpy()[ok] / rr[ok]})
    g = df.groupby("age").ratio
    grid = np.arange(0.25, 46.01, 0.25)
    results["curve"] = {
        "lookup": [[int(k) + 0.5, float(v.median()), float(v.quantile(.25)), float(v.quantile(.75)), int(len(v))] for k, v in g if len(v) >= 30],
        "hump": [[float(x), float(hump(x, p_h))] for x in grid],
        "hump_dip": [[float(x), float(hump_dip(x, p_hd))] for x in grid],
    }
    (ev.DATA_DIR / "hump_curve.json").write_text(json.dumps(results))
    print(f"\nwrote {ev.DATA_DIR / 'hump_curve.json'}")


if __name__ == "__main__":
    main()
