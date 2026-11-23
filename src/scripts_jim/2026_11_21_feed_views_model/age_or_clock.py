# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""Is the dip in the effective hours left near 23 hours an effect of age or of
the time of day? (GOO-844)

A post 23 hours old is at nearly the same time of day as when it was posted.
If the dip comes from the daily rhythm, it should move with the posting hour:
a post posted at 06 UTC would dip at a different age than one posted at 18 UTC.
If it comes from age, it stays near 23 hours for every posting hour.

Three looks:
  1. Per group of posting hours, the median of (views still to come / rate now)
     per hour of age, divided by the smooth hump without a dip. The age where
     that ratio is lowest is the group's dip.
  2. The lookup per hour of age fitted alone and fitted together with a factor
     per UTC hour of the decision moment. If the dip vanishes once the hour of
     day is in the model, it was the hour of day.
  3. On the test posts: the hump with dip against the hump without a dip times
     a factor per UTC hour, and both together.

    uv run src/scripts_jim/2026_11_21_feed_views_model/age_or_clock.py
"""

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

import daily_rhythm as dr
import evaluate as ev
import hump_formula as hf
import simple_formulas as sf
import ten_minutes as tm

POSTING_GROUPS_H = [(0, 6), (6, 12), (12, 18), (18, 24)]
DIP_SEARCH_AGES_H = range(12, 38)
MIN_PER_BIN = 40


def posting_hour(ex: pd.DataFrame, posted: pd.Series) -> np.ndarray:
    p = pd.to_datetime(posted.reindex(ex.tweet_id).to_numpy(), utc=True)
    return (p.hour + p.minute / 60).to_numpy()


def dips_per_posting_group(train: pd.DataFrame, p_hump) -> None:
    r = sf.rate(train)
    ok = (r > 0).to_numpy() if hasattr(r, "to_numpy") else r > 0
    df = pd.DataFrame({
        "age": np.floor(train.age.to_numpy()[ok]).astype(int),
        "post_h": train.post_h.to_numpy()[ok],
        "rel": train.to_come.to_numpy()[ok] / r[ok] / hf.hump(np.floor(train.age.to_numpy()[ok]) + 0.5, p_hump),
    })
    print("1. Median (views to come / rate) relative to the hump without dip, per hour of age")
    print("   group      " + " ".join(f"{a:>4d}" for a in DIP_SEARCH_AGES_H) + "   lowest at")
    for lo, hi in POSTING_GROUPS_H:
        g = df[(df.post_h >= lo) & (df.post_h < hi) & df.age.isin(DIP_SEARCH_AGES_H)].groupby("age").rel
        med = g.median().where(g.size() >= MIN_PER_BIN)
        cells = " ".join(f"{med.get(a, np.nan):4.2f}" if pd.notna(med.get(a, np.nan)) else "   ." for a in DIP_SEARCH_AGES_H)
        lowest = med.idxmin() if med.notna().any() else None
        clock = f"(UTC {(lo + hi) / 2 + lowest + 0.5:.0f} mod 24 = {((lo + hi) / 2 + lowest + 0.5) % 24:.0f})" if lowest is not None else ""
        print(f"   {lo:02d}-{hi:02d} UTC  {cells}   {lowest} h {clock}   n={int(g.size().sum())}")


def lookup_with_and_without_clock(train: pd.DataFrame) -> None:
    r = sf.rate(train)
    ok = (r > 0) & (train.to_come > 0)
    X, y = dr.design(train[ok]), np.log(train.to_come[ok] / r[ok])
    both = LinearRegression(fit_intercept=False).fit(X, y)
    age_only = LinearRegression(fit_intercept=False).fit(X[:, : dr.MAX_AGE_BIN + 1], y)
    shift = both.coef_[dr.MAX_AGE_BIN + 1:].mean()
    print("\n2. Effective hours left per hour of age, fitted alone and with a factor per UTC hour")
    print("   age    " + " ".join(f"{a:>5d}" for a in DIP_SEARCH_AGES_H))
    print("   alone  " + " ".join(f"{np.exp(age_only.coef_[a]):5.1f}" for a in DIP_SEARCH_AGES_H))
    print("   +clock " + " ".join(f"{np.exp(both.coef_[a] + shift):5.1f}" for a in DIP_SEARCH_AGES_H))


def clock_factors(train: pd.DataFrame, shape, p) -> np.ndarray:
    """The median log ratio of views to come to the shape's prediction, per UTC hour."""
    r = sf.rate(train)
    ok = (r > 0) & (train.to_come > 0)
    resid = np.log(train.to_come[ok] / (r[ok] * shape(train.age.to_numpy()[ok], p)))
    return pd.Series(resid.to_numpy()).groupby(train.clock.to_numpy()[ok]).median().reindex(range(24)).fillna(0).to_numpy()


def main() -> None:
    views, profiles = ev.load()
    series = ev.series_by_post(views, profiles.author_followers)
    posted = pd.Series({t: v[0] for t, v in series.items()})
    test_ids = {t for t in series if ev.is_test_post(t)}
    train = dr.add_clock(tm.examples_at(series, [(t, a, {}) for t in series if t not in test_ids for a in tm.HALF_HOUR_STEPS_H]), posted)
    train["post_h"] = posting_hour(train, posted)
    print(f"{len(series):,} posts, {len(train):,} training examples\n")

    p_h = sf.fit(train, hf.hump, [15.0, 4.0, 10.0])
    p_hd = min((sf.fit(train, hf.hump_dip, [*p_h, d, mu, w]) for d, mu, w in [(0.4, 24, 3), (0.3, 22, 5), (0.5, 26, 2)]),
               key=lambda p: np.mean((np.log1p(sf.rate(train) * hf.hump_dip(train.age.to_numpy(), p)) - np.log1p(train.to_come.to_numpy())) ** 2))
    print(f"hump with dip on today's data: d = {np.clip(p_hd[3], 0, .95):.2f}, mu = {p_hd[4]:.1f} h, w = {abs(p_hd[5]):.1f} h\n")

    dips_per_posting_group(train, p_h)
    lookup_with_and_without_clock(train)

    day_h = clock_factors(train, hf.hump, p_h)
    day_hd = clock_factors(train, hf.hump_dip, p_hd)
    print("\n   UTC hour factor on top of the hump: " + " ".join(f"{h}:{np.exp(f):.2f}" for h, f in enumerate(day_h)))

    def predictions(ex):
        r, a, c = sf.rate(ex), ex.age.to_numpy(), ex.clock.to_numpy()
        return {
            "hump": r * hf.hump(a, p_h),
            "hump with dip": r * hf.hump_dip(a, p_hd),
            "hump x hour of day": r * hf.hump(a, p_h) * np.exp(day_h[c]),
            "hump with dip x hour of day": r * hf.hump_dip(a, p_hd) * np.exp(day_hd[c]),
        }

    print("\n3. Test posts")
    test = dr.add_clock(tm.examples_at(series, [(t, a, {}) for t in test_ids for a in sf.DECISION_AGES_H + [18, 30, 36]]), posted)
    for age in sorted(test.age.unique()):
        part = test[test.age == age]
        if len(part) < ev.MIN_TEST_POSTS:
            continue
        cells = "  ".join(f"{name} x{ev.metrics(part.to_come.to_numpy(), np.asarray(p, dtype=float))['median_error']:.2f}" for name, p in predictions(part).items())
        print(f"   age {age:4.0f} h ({len(part)} posts): {cells}")

    test_series = {t: series[t] for t in test_ids}
    first = min(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MAX_AGE_H)
    last = max(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MIN_AGE_H)
    moments = [(tid, (t - v[0]).total_seconds() / 3600, {"snapshot": k}) for k, t in enumerate(pd.date_range(first, last, freq="1h"))
               for tid, v in test_series.items() if 0.25 <= (t - v[0]).total_seconds() / 3600 <= ev.SNAPSHOT_MAX_AGE_H]
    ex = dr.add_clock(tm.examples_at(series, moments), posted)
    print(f"\n   Ranking at {ex.snapshot.nunique()} moments, {len(ex) / ex.snapshot.nunique():.0f} posts each:")
    for name, p in predictions(ex).items():
        tm.score(name, ex, np.asarray(p, dtype=float))


if __name__ == "__main__":
    main()
