# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""The cliff model as the X run will use it (GOO-863).

The X run only takes posts younger than 24 hours (STALE_TWEET_CUTOFF_HOURS),
so the model is fitted on decision ages below 24 hours, with the cliff fixed
at 24.0 hours, where the measured fall starts. That leaves three numbers: the
power b of the slow fade, the share c of speed left after the cliff, and the
extra fade tau_post after it.

Then it picks the floor on predicted views still to come that admits as many
posts as today's floor of 15,000 views per hour. It replays the X run on the
recorder's walks: every half hour, every post younger than 24 hours in the
feed, with its views now and 10 minutes earlier.

    uv run src/scripts_jim/2026_11_21_feed_views_model/production_fit.py
"""

import json

import numpy as np
import pandas as pd

import cliff_model as cm
import evaluate as ev
import simple_formulas as sf
import ten_minutes as tm

CLIFF_H = 24.0
NO_FADE_BEFORE_CLIFF_H = 1e9
STALE_CUTOFF_H = 24.0
VELOCITY_FLOOR_PER_H = 15_000
REPLAY_EVERY = "30min"


def live_hours(a, p):
    b, c, tau_post = p
    return cm.cliff_hours(a, [b, NO_FADE_BEFORE_CLIFF_H, c, tau_post, CLIFF_H])


def replay(views: pd.DataFrame, p) -> pd.DataFrame:
    """Every post younger than 24 hours at each replayed X run, with both rules' numbers."""
    walk_times = np.sort(views.observed_at.dt.floor("10min").unique())
    runs = pd.date_range(walk_times[6], walk_times[-1], freq=REPLAY_EVERY)
    v = views.assign(slot=views.observed_at.dt.floor("10min"))
    rows = []
    for run in runs:
        now = v[v.slot == run].set_index("tweet_id")
        before = v[v.slot == run - pd.Timedelta(minutes=10)].set_index("tweet_id")
        now = now[(now.age_h > 0) & (now.age_h <= STALE_CUTOFF_H)]
        joined = now.join(before[["impressions", "observed_at"]], rsuffix="_before", how="left")
        hours = (joined.observed_at - joined.observed_at_before).dt.total_seconds() / 3600
        rate = np.clip(joined.impressions - joined.impressions_before, 0, None) / hours
        rows.append(pd.DataFrame({
            "run": run, "tweet_id": joined.index, "tier": joined.tier.to_numpy(), "age": joined.age_h.to_numpy(),
            "velocity": joined.impressions.to_numpy() / np.maximum(joined.age_h.to_numpy(), 0.25),
            "predicted": (rate * live_hours(joined.age_h.to_numpy(), p)).to_numpy(),
        }))
    return pd.concat(rows, ignore_index=True)


def main() -> None:
    views, profiles = ev.load()
    series = ev.series_by_post(views, profiles.author_followers)
    test_ids = {t for t in series if ev.is_test_post(t)}
    young = [a for a in tm.HALF_HOUR_STEPS_H if a < STALE_CUTOFF_H]
    train = tm.examples_at(series, [(t, a, {}) for t in series if t not in test_ids for a in young])
    p = sf.fit(train, live_hours, [0.7, 0.5, 20.0])
    p = [abs(p[0]), float(np.clip(p[1], 0, 1.5)), abs(p[2])]
    print(f"live cliff model: b = {p[0]:.3f}, c = {p[1]:.3f}, tau_post = {p[2]:.2f} h  ({len(train):,} training examples)")
    grid = [0.5, 1, 2, 3, 6, 9, 12, 15, 18, 20, 22, 23, 23.5, 23.9]
    print("H(age): " + "  ".join(f"{a}h:{h:.2f}" for a, h in zip(grid, live_hours(np.array(grid), p))))

    test = tm.examples_at(series, [(t, a, {}) for t in test_ids for a in [1, 2, 3, 6, 12, 18, 23]])
    print("\nTest posts, typical error:")
    for age in sorted(test.age.unique()):
        part = test[test.age == age]
        m = ev.metrics(part.to_come.to_numpy(), sf.rate(part) * live_hours(part.age.to_numpy(), p))
        print(f"  age {age:4.0f} h ({len(part)} posts): x{m['median_error']:.2f}, within 2x {m['within_2x']:.0%}")

    r = replay(views, p)
    known = r.predicted.notna()
    per_run_velocity = (r.velocity >= VELOCITY_FLOOR_PER_H).groupby(r.run).sum()
    target = per_run_velocity.mean()
    ranked = r[known].groupby("run").predicted.apply(lambda s: np.sort(s.to_numpy())[::-1])
    candidates = np.unique(np.round(np.geomspace(5_000, 2_000_000, 400), -3))
    counts = [np.mean([(x >= f).sum() for x in ranked]) for f in candidates]
    floor = float(candidates[int(np.argmin(np.abs(np.array(counts) - target)))])
    print(f"\nReplayed {r.run.nunique()} X runs, {len(r) / r.run.nunique():.0f} posts under 24 h each, {1 - known.mean():.1%} without a reading 10 minutes earlier")
    print(f"velocity >= {VELOCITY_FLOOR_PER_H:,}/h admits {target:.0f} posts per run")
    print(f"predicted views to come >= {floor:,.0f} admits {np.mean([(x >= floor).sum() for x in ranked]):.0f} posts per run")
    by_tier = r.assign(v=r.velocity >= VELOCITY_FLOOR_PER_H, pr=r.predicted >= floor).groupby("tier")[["v", "pr"]].sum() / r.run.nunique()
    print("per run and tier (velocity rule, prediction rule):\n" + by_tier.round(1).to_string())
    both = ((r.velocity >= VELOCITY_FLOOR_PER_H) & (r.predicted >= floor)).sum() / max((r.velocity >= VELOCITY_FLOOR_PER_H).sum(), 1)
    print(f"share of the velocity rule's posts the prediction rule also admits: {both:.0%}")
    (ev.DATA_DIR / "live_cliff.json").write_text(json.dumps({"b": p[0], "c": p[1], "tau_post": p[2], "cliff_h": CLIFF_H, "floor": floor}))


if __name__ == "__main__":
    main()
