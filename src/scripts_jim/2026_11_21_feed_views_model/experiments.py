# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""First experiments for the view prediction model (GOO-844).

The question: at a decision moment, when a post is `a` hours old, how many
views will it have at 48 hours after posting? A post barely grows after that
(day_one.py), and it is the final number Jim suggested.

What matters for us is the views still to come, V48 minus the views now,
because those are the views a note could still reach. So every method is
scored on the views to come:
  - the median error factor: exp of the median absolute log error,
  - Spearman's rank correlation between predicted and true views to come,
    because the X run uses the prediction to rank posts.

Methods:
  - velocity: the production signal, views divided by age, extrapolated
    linearly to 48 hours.
  - log curve: V(t) = A ln(1 + t / c) with c = 0.3 h, fitted to the current
    reading alone (the July experiment, 2026_07_22_log_views_experiment).
  - recent rate: the growth over the last hour, kept constant until 48 h.
  - power decay: the growth rate falls as t^-k. k is fitted from the growth
    of the last hour and the hour before, and the rate is integrated to 48 h.
    This is the "decide the curve, then plug into the formula" idea.
  - boosted trees on the log growth over the last 10 minutes, 1, 2 and 4
    hours, the age, and the views now.

    uv run src/scripts_jim/2026_11_21_feed_views_model/experiments.py
"""

from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor

DATA_DIR = Path.home() / "dev/data/goo-834"
TARGET_AGE_H = 48
DECISION_AGES_H = [3, 6, 12, 24]
LOOKBACKS_H = [1 / 6, 1, 2, 4]
X_EPOCH_MS = 1288834974657
LOG_CURVE_C_H = 0.3
# The reading used for an age must lie within this much of it.
MAX_READING_GAP_H = 0.25


def load_views() -> pd.DataFrame:
    views = pd.concat(pd.read_parquet(p) for p in sorted((DATA_DIR / "views").glob("*.parquet")))
    views["observed_at"] = pd.to_datetime(views["observed_at"], format="ISO8601")
    # A tweet id is an X "snowflake": its top bits are milliseconds since X's epoch.
    posted_ms = np.right_shift(views["tweet_id"].astype("int64").to_numpy(), 22) + X_EPOCH_MS
    posted_at = pd.to_datetime(posted_ms, unit="ms", utc=True)
    views["age_h"] = (views["observed_at"] - posted_at).dt.total_seconds() / 3600
    return views.sort_values(["tweet_id", "age_h"])[["tweet_id", "age_h", "impressions"]]


def views_at(series: pd.DataFrame, age: float) -> float | None:
    """Views at the given age, interpolated between the two nearest readings."""
    ages, imps = series.age_h.to_numpy(), series.impressions.to_numpy()
    i = np.searchsorted(ages, age)
    if i == 0 or i == len(ages):
        return None
    if ages[i] - ages[i - 1] > 2 * MAX_READING_GAP_H:
        return None
    w = (age - ages[i - 1]) / (ages[i] - ages[i - 1])
    return imps[i - 1] + w * (imps[i] - imps[i - 1])


def build_examples(views: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for tweet_id, series in views.groupby("tweet_id", sort=False):
        v48 = views_at(series, TARGET_AGE_H)
        if v48 is None:
            continue
        for a in DECISION_AGES_H:
            now = views_at(series, a)
            # A lookback that reaches back to the posting is not available.
            past = {lb: views_at(series, a - lb) if lb < a else 0.0 for lb in LOOKBACKS_H}
            if now is None or any(v is None for v in past.values()):
                continue
            row = {"tweet_id": tweet_id, "age": a, "now": now, "v48": v48}
            for lb, v in past.items():
                row[f"past_{lb:.2f}"] = v
            rows.append(row)
    return pd.DataFrame(rows)


def predict_to_come(ex: pd.DataFrame) -> dict[str, np.ndarray]:
    a, now = ex.age.to_numpy(), ex.now.to_numpy()
    remaining = TARGET_AGE_H - a
    rate_1h = now - ex["past_1.00"].to_numpy()
    rate_prev = ex["past_1.00"].to_numpy() - ex["past_2.00"].to_numpy()
    k = np.log(np.clip(rate_prev, 1, None) / np.clip(rate_1h, 1, None)) / np.log((a - 0.5) / (a - 1.5))
    k = np.clip(k, 0.0, 5.0)
    # The rate at age a - 0.5 is rate_1h per hour, and it falls as t^-k.
    t0 = a - 0.5
    with np.errstate(divide="ignore", invalid="ignore"):
        integral = np.where(
            np.isclose(k, 1.0),
            t0 * np.log(TARGET_AGE_H / a),
            t0**k * (TARGET_AGE_H ** (1 - k) - a ** (1 - k)) / (1 - k),
        )
    return {
        "velocity": now / a * remaining,
        "log curve": now * (np.log1p(TARGET_AGE_H / LOG_CURVE_C_H) / np.log1p(a / LOG_CURVE_C_H) - 1),
        "recent rate": rate_1h * remaining,
        "power decay": rate_1h * integral,
    }


def features(ex: pd.DataFrame) -> np.ndarray:
    cols = [np.log(ex.age), np.log1p(ex.now)]
    for lb in LOOKBACKS_H:
        cols.append(np.log1p(ex.now - ex[f"past_{lb:.2f}"]) - np.log(lb))
    return np.column_stack(cols)


def score(true: np.ndarray, pred: np.ndarray) -> tuple[float, float]:
    err = np.abs(np.log1p(np.clip(pred, 0, None)) - np.log1p(true))
    return float(np.exp(np.median(err))), float(spearmanr(pred, true).statistic)


def main() -> None:
    ex = build_examples(load_views())
    ex = ex.reset_index(drop=True)
    ex["to_come"] = ex.v48 - ex.now
    print(f"{len(ex):,} examples from {ex.tweet_id.nunique():,} posts")
    # Exploration only: split by post, not by time. The final test splits by time.
    test_mask = ex.tweet_id.astype("int64") % 5 == 0
    for a in DECISION_AGES_H:
        part = ex[ex.age == a]
        test = part[test_mask.loc[part.index]]
        if test.empty:
            print(f"\nage {a} h: no posts with readings from {a - max(LOOKBACKS_H):.0f} h to {TARGET_AGE_H} h yet")
            continue
        train = ex[~test_mask]
        preds = predict_to_come(test)
        model = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05)
        model.fit(features(train), np.log1p(train.to_come))
        preds["boosted trees"] = np.expm1(model.predict(features(test)))
        print(f"\nage {a} h: {len(part):,} posts, test {len(test):,}, median views now {part.now.median():,.0f}, median to come {part.to_come.median():,.0f}")
        for name, pred in preds.items():
            factor, rho = score(test.to_come.to_numpy(), pred)
            print(f"  {name:14s} median error x{factor:5.2f}   rank correlation {rho:.3f}")


main()
