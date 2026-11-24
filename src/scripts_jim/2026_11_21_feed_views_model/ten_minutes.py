# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""Can a ranking that waits only 10 minutes match one that waits an hour? (GOO-844)

The same snapshot test as evaluate.py: at a moment, rank every held-out post in
the feed by its predicted views still to come, pick the top 2% and the top 10%,
and score the share of the best possible views. Here every method may use only
the post's age, its views now, and its views 10 minutes earlier. So every post
with at least 10 minutes of readings takes part, including posts that just
entered the feed, which the hour-long methods could not rank.

For comparison, the same moments are also scored on the posts that do have an
hour of readings, with the last hour's growth.

    uv run src/scripts_jim/2026_11_21_feed_views_model/ten_minutes.py
"""

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression

import evaluate as ev

TEN_MINUTES_H = 1 / 6
HALF_HOUR_STEPS_H = [a / 2 for a in range(1, 81)]
AGE_BAND = 1.5


def views_ago(row, hours: float) -> float | None:
    if hours >= row.age:
        return 0.0
    return ev.views_at(row.hist_ages_all, row.hist_imps_all, row.age - hours)


def examples_at(series: dict, moments: list[tuple[str, float]]) -> pd.DataFrame:
    rows = []
    for tid, a, extra in moments:
        posted_at, ages, imps, tiers, followers, v48 = series[tid]
        now = ev.views_at(ages, imps, a)
        ten = (0.0 if TEN_MINUTES_H >= a else ev.views_at(ages, imps, a - TEN_MINUTES_H))
        if now is None or ten is None:
            continue
        hour = 0.0 if 1 >= a else ev.views_at(ages, imps, a - 1)
        rows.append({"tweet_id": tid, "age": a, "now": now, "ten": ten, "hour": hour, "v48": v48, **extra})
    ex = pd.DataFrame(rows)
    ex["to_come"] = (ex.v48 - ex.now).clip(lower=0)
    return ex


def features(ex: pd.DataFrame) -> np.ndarray:
    growth_10 = np.log1p((ex.now - ex.ten).clip(lower=0)) - np.log(TEN_MINUTES_H)
    return np.column_stack([np.log(ex.age), np.log1p(ex.now), growth_10])


class PerAgeFormula:
    def fit(self, train: pd.DataFrame):
        self.models = {}
        for a in range(1, 41):
            part = train[(train.age >= a / AGE_BAND) & (train.age <= a * AGE_BAND)]
            if len(part) >= 50:
                self.models[a] = LinearRegression().fit(features(part), np.log1p(part.to_come))
        return self

    def predict(self, X_ex: pd.DataFrame) -> np.ndarray:
        fitted = np.array(sorted(self.models))
        nearest = fitted[np.abs(X_ex.age.to_numpy()[:, None] - fitted[None, :]).argmin(axis=1)]
        out = np.empty(len(X_ex))
        for a in np.unique(nearest):
            m = nearest == a
            out[m] = self.models[a].predict(features(X_ex[m]))
        return out


def main() -> None:
    views, profiles = ev.load()
    series = ev.series_by_post(views, profiles.author_followers)
    test_ids = {t for t in series if ev.is_test_post(t)}
    train_moments = [(t, a, {}) for t in series if t not in test_ids for a in HALF_HOUR_STEPS_H]
    train = examples_at(series, train_moments)
    target = np.log1p(train.to_come)
    trees = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=0).fit(features(train), target)
    formula = PerAgeFormula().fit(train)
    print(f"trained on {train.tweet_id.nunique():,} posts, {len(train):,} examples")

    test_series = {t: series[t] for t in test_ids}
    first = min(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MAX_AGE_H)
    last = max(v[0] for v in test_series.values()) + pd.Timedelta(hours=ev.SNAPSHOT_MIN_AGE_H)
    moments = []
    for k, t in enumerate(pd.date_range(first, last, freq="1h")):
        for tid, v in test_series.items():
            a = (t - v[0]).total_seconds() / 3600
            if 0.25 <= a <= ev.SNAPSHOT_MAX_AGE_H:
                moments.append((tid, a, {"snapshot": k}))
    ex = examples_at(series, moments)
    print(f"{ex.snapshot.nunique()} moments, {len(ex) / ex.snapshot.nunique():.0f} posts each on average, of which {ex.hour.notna().mean():.0%} have an hour of readings")

    preds = {
        "velocity (production order)": ex.now / ex.age,
        "last 10 minutes' growth": ex.now - ex.ten,
        "boosted trees, 10 minutes": np.expm1(trees.predict(features(ex))),
        "formula per age, 10 minutes": np.expm1(formula.predict(ex)),
    }
    for name, pred in preds.items():
        score(name, ex, np.asarray(pred, dtype=float))

    with_hour = ex[ex.hour.notna()]
    print(f"\nOnly the posts with an hour of readings ({len(with_hour) / with_hour.snapshot.nunique():.0f} per moment):")
    for name, pred in {
        "velocity (production order)": with_hour.now / with_hour.age,
        "last 10 minutes' growth": with_hour.now - with_hour.ten,
        "last hour's growth": with_hour.now - with_hour.hour,
        "boosted trees, 10 minutes": np.expm1(trees.predict(features(with_hour))),
    }.items():
        score(name, with_hour, np.asarray(pred, dtype=float))


def score(name: str, ex: pd.DataFrame, pred: np.ndarray) -> None:
    top2, top10, rho = [], [], []
    for _, part in ex.assign(pred=pred).groupby("snapshot"):
        true, p = part.to_come.to_numpy(), part.pred.to_numpy()
        top2.append(ev.capture(true, p, ev.STRICT_TOP_SHARE))
        top10.append(ev.capture(true, p, ev.TOP_SHARE))
        rho.append(spearmanr(p, true).statistic)
    boots = [np.mean(ev.RNG.choice(top2, len(top2))) for _ in range(ev.BOOTSTRAP_ROUNDS)]
    print(f"  {name:30s} top 2% {np.mean(top2):.0%} [{np.percentile(boots, 2.5):.0%}-{np.percentile(boots, 97.5):.0%}]  top 10% {np.mean(top10):.0%}  rank corr {np.mean(rho):.3f}")


if __name__ == "__main__":
    main()
