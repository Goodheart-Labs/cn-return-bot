# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""The 24-hour cliff (GOO-844).

age_or_clock.py showed that the dip in the effective hours left sits at an age
of 23 to 24 hours for every posting hour, so it is not the time of day. The
median speed of views stays almost flat from 20 to 24 hours and then falls by
about half within one hour. X seems to stop spreading a post at 24 hours.

This script first measures the cliff in 10-minute steps, then fits a model
that describes the speed directly. From the age a with speed r (the 10-minute
gain times 6), the speed at a later age t is

    r x (t / a)^-b x exp(-(min(t, T) - a) / tau_pre)                    for t < T
    r x (T / a)^-b x exp(-(T - a) / tau_pre) x c x exp(-(t - T) / tau_post) for t >= T

for a post younger than the cliff age T, and r x (t / a)^-b x exp(-(t - a) / tau_post)
for an older one. The power b is the fading launch burst, tau_pre and tau_post
are the slow fades before and after the cliff, and c is how much speed is left
right after it. Views still to come are this speed summed up to 48 hours. So
the effective hours left H(a) are computed, not chosen as a shape.

    uv run src/scripts_jim/2026_11_21_feed_views_model/cliff_model.py
"""

import json

import numpy as np
import pandas as pd

import evaluate as ev
import hump_formula as hf
import simple_formulas as sf
import ten_minutes as tm

T_END = 48.0
STEP_H = 1 / 30
AGE_GRID = np.arange(STEP_H, T_END, STEP_H)
CLIFF_WINDOW_H = (22.0, 26.0)
CLIFF_REFERENCE_AGE_H = 22.0


def cliff_hours(a, p):
    """Effective hours left at each age in a, for the parameters p = (b, tau_pre, c, tau_post, T)."""
    b, tau_pre, c, tau_post, cliff = abs(p[0]), abs(p[1]), float(np.clip(p[2], 0, 1.5)), abs(p[3]), p[4]
    t = AGE_GRID[None, :]
    start = AGE_GRID[:, None]
    before = t < cliff
    young = start < cliff
    fade_young = np.where(before, np.exp(-(np.minimum(t, cliff) - start) / tau_pre),
                          np.exp(-(cliff - start) / tau_pre) * c * np.exp(-(t - cliff) / tau_post))
    fade = np.where(young, fade_young, np.exp(-(t - start) / tau_post))
    speed = (t / start) ** -b * fade * (t >= start)
    hours = speed.sum(axis=1) * STEP_H
    return np.interp(np.asarray(a, dtype=float), AGE_GRID, hours)


def cliff_in_steps(series: dict) -> list[list[float]]:
    """The median speed per 10 minutes from 22 to 26 hours, relative to the speed at 22 hours."""
    grid = np.arange(CLIFF_WINDOW_H[0], CLIFF_WINDOW_H[1] + 1e-9, tm.TEN_MINUTES_H)
    rows = []
    for _, ages, imps, *_ in series.values():
        vals = [ev.views_at(ages, imps, a) for a in grid]
        if any(v is None for v in vals):
            continue
        speed = np.diff(vals)
        if speed[0] > 0:
            rows.append(speed / speed[0])
    med = np.median(np.array(rows), axis=0)
    mids = grid[:-1] + tm.TEN_MINUTES_H / 2
    print(f"Median speed relative to the first 10 minutes after {CLIFF_REFERENCE_AGE_H:.0f} h ({len(rows)} posts):")
    print("  " + "  ".join(f"{m:.2f}h:{x:.2f}" for m, x in zip(mids, med)))
    return [[float(m), float(x)] for m, x in zip(mids, med)]


def main() -> None:
    views, profiles = ev.load()
    series = ev.series_by_post(views, profiles.author_followers)
    steps = cliff_in_steps(series)

    test_ids = {t for t in series if ev.is_test_post(t)}
    train = tm.examples_at(series, [(t, a, {}) for t in series if t not in test_ids for a in tm.HALF_HOUR_STEPS_H])
    p_c = sf.fit(train, cliff_hours, [0.3, 20.0, 0.5, 8.0, 24.0])
    b, tau_pre, c, tau_post, cliff = abs(p_c[0]), abs(p_c[1]), float(np.clip(p_c[2], 0, 1.5)), abs(p_c[3]), p_c[4]
    print(f"\ncliff model: b = {b:.2f}, tau_pre = {tau_pre:.1f} h, c = {c:.2f}, tau_post = {tau_post:.1f} h, T = {cliff:.1f} h")
    p_h = sf.fit(train, hf.hump, [15.0, 4.0, 10.0])
    p_hd = min((sf.fit(train, hf.hump_dip, [*p_h, d, mu, w]) for d, mu, w in [(0.4, 24, 3), (0.3, 22, 5), (0.5, 26, 2)]),
               key=lambda p: np.mean((np.log1p(sf.rate(train) * hf.hump_dip(train.age.to_numpy(), p)) - np.log1p(train.to_come.to_numpy())) ** 2))
    lookup = sf.Lookup().fit(train)

    def predictions(ex):
        r, a = sf.rate(ex), ex.age.to_numpy()
        return {
            "hump with dip (6 numbers)": r * hf.hump_dip(a, p_hd),
            "cliff model (5 numbers)": r * cliff_hours(a, p_c),
            "lookup table (48 numbers)": r * lookup.hours(a),
        }

    print("\nTest posts, typical error:")
    test = tm.examples_at(series, [(t, a, {}) for t in test_ids for a in sf.DECISION_AGES_H + [18, 23, 30, 36]])
    results = {"steps": steps, "params": {"b": b, "tau_pre": tau_pre, "c": c, "tau_post": tau_post, "T": cliff}, "ages": {}}
    for age in sorted(test.age.unique()):
        part = test[test.age == age]
        if len(part) < ev.MIN_TEST_POSTS:
            continue
        ms = {name: ev.metrics(part.to_come.to_numpy(), np.asarray(p, dtype=float)) for name, p in predictions(part).items()}
        results["ages"][float(age)] = {name: m["median_error"] for name, m in ms.items()}
        print(f"  age {age:4.0f} h ({len(part)} posts): " + "  ".join(f"{name} x{m['median_error']:.2f}" for name, m in ms.items()))

    test_series = {t: series[t] for t in test_ids}
    first = min(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MAX_AGE_H)
    last = max(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MIN_AGE_H)
    moments = [(tid, (t - v[0]).total_seconds() / 3600, {"snapshot": k}) for k, t in enumerate(pd.date_range(first, last, freq="1h"))
               for tid, v in test_series.items() if 0.25 <= (t - v[0]).total_seconds() / 3600 <= ev.SNAPSHOT_MAX_AGE_H]
    ex = tm.examples_at(series, moments)
    print(f"\nRanking at {ex.snapshot.nunique()} moments, {len(ex) / ex.snapshot.nunique():.0f} posts each:")
    for name, p in predictions(ex).items():
        tm.score(name, ex, np.asarray(p, dtype=float))

    grid = np.arange(0.25, 46.01, 0.25)
    results["curve"] = {"cliff": [[float(x), float(h)] for x, h in zip(grid, cliff_hours(grid, p_c))],
                        "hump_dip": [[float(x), float(hf.hump_dip(x, p_hd))] for x in grid]}
    (ev.DATA_DIR / "cliff_curve.json").write_text(json.dumps(results))
    print(f"\nwrote {ev.DATA_DIR / 'cliff_curve.json'}")


if __name__ == "__main__":
    main()
