# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""The simple formula plus the hour of day (GOO-844).

    views still to come = rate now x hours left(age) x day factor(UTC hour now)

The rate now is the 10-minute gain times 6. Both factors are lookup tables,
one number per hour of age and one per hour of the day, fitted together on the
training posts by least squares on log(views still to come / rate now).

    uv run src/scripts_jim/2026_11_21_feed_views_model/daily_rhythm.py
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression

import evaluate as ev
import simple_formulas as sf
import ten_minutes as tm

MAX_AGE_BIN = 47


def add_clock(ex: pd.DataFrame, posted: pd.Series) -> pd.DataFrame:
    p = pd.to_datetime(posted.reindex(ex.tweet_id).to_numpy(), utc=True)
    ex = ex.copy()
    ex["clock"] = np.floor((p.hour + p.minute / 60 + ex.age.to_numpy()) % 24).astype(int)
    return ex


def design(ex: pd.DataFrame) -> np.ndarray:
    age_bin = np.clip(np.floor(ex.age.to_numpy()).astype(int), 0, MAX_AGE_BIN)
    return np.hstack([np.eye(MAX_AGE_BIN + 1)[age_bin], np.eye(24)[ex.clock.to_numpy()]])


def main() -> None:
    views, profiles = ev.load()
    series = ev.series_by_post(views, profiles.author_followers)
    posted = pd.Series({t: v[0] for t, v in series.items()})
    test_ids = {t for t in series if ev.is_test_post(t)}
    train = add_clock(tm.examples_at(series, [(t, a, {}) for t in series if t not in test_ids for a in tm.HALF_HOUR_STEPS_H]), posted)
    r = sf.rate(train)
    ok = (r > 0) & (train.to_come > 0)
    table = LinearRegression(fit_intercept=False).fit(design(train[ok]), np.log(train.to_come[ok] / r[ok]))
    age_only = LinearRegression(fit_intercept=False).fit(design(train[ok])[:, : MAX_AGE_BIN + 1], np.log(train.to_come[ok] / r[ok]))
    day = np.exp(table.coef_[MAX_AGE_BIN + 1:] - table.coef_[MAX_AGE_BIN + 1:].mean())
    print("day factor by UTC hour:", " ".join(f"{h}:{f:.2f}" for h, f in enumerate(day)))

    feats_clock = lambda ex: np.column_stack([tm.features(ex), np.sin(2 * np.pi * ex.clock / 24), np.cos(2 * np.pi * ex.clock / 24)])
    trees = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=0).fit(tm.features(train), np.log1p(train.to_come))
    trees_clock = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=0).fit(feats_clock(train), np.log1p(train.to_come))

    def predictions(ex):
        r = sf.rate(ex)
        return {
            "rate x hours left(age)": r * np.exp(age_only.predict(design(ex)[:, : MAX_AGE_BIN + 1])),
            "rate x hours left(age) x day factor": r * np.exp(table.predict(design(ex))),
            "boosted trees, 10 minutes": np.expm1(trees.predict(tm.features(ex))),
            "boosted trees, 10 minutes + hour of day": np.expm1(trees_clock.predict(feats_clock(ex))),
        }

    test = add_clock(tm.examples_at(series, [(t, a, {}) for t in test_ids for a in sf.DECISION_AGES_H]), posted)
    for a in sf.DECISION_AGES_H:
        part = test[test.age == a]
        print(f"\nage {a} h: {len(part)} test posts")
        for name, p in predictions(part).items():
            m = ev.metrics(part.to_come.to_numpy(), np.asarray(p, dtype=float))
            print(f"  {name:42s} typical error x{m['median_error']:.2f}  within 2x {m['within_2x']:.0%}")

    test_series = {t: series[t] for t in test_ids}
    first = min(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MAX_AGE_H)
    last = max(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MIN_AGE_H)
    moments = [(tid, (t - v[0]).total_seconds() / 3600, {"snapshot": k}) for k, t in enumerate(pd.date_range(first, last, freq="1h"))
               for tid, v in test_series.items() if 0.25 <= (t - v[0]).total_seconds() / 3600 <= ev.SNAPSHOT_MAX_AGE_H]
    ex = add_clock(tm.examples_at(series, moments), posted)
    print(f"\nRanking at {ex.snapshot.nunique()} moments, {len(ex) / ex.snapshot.nunique():.0f} posts each:")
    for name, p in predictions(ex).items():
        tm.score(name, ex, np.asarray(p, dtype=float))


if __name__ == "__main__":
    main()
