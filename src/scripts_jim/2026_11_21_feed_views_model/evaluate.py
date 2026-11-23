# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""The view prediction evaluation (GOO-844).

The question: when a post is `a` hours old, how many views will it still get
before it is 48 hours old? A post barely grows after 48 hours (day_one.py), so
that is the final number. The views still to come are what a note could reach.

Train and test: every post whose readings reach 48 hours. The posts are split
by posting time: the newest quarter is the test set, everything before it
trains. So the test asks whether a model built from the past predicts later
posts.

Methods:
  velocity      the production signal: views so far divided by age, extended
                in a straight line to 48 hours.
  log curve     V(t) = A ln(1 + t / 0.3 h), fitted to the current reading only
                (2026_07_22_log_views_experiment).
  sigmoid fit   a sigmoid in log time, V(t) = L / (1 + (c / t)^k), fitted to all
                of the post's readings so far. Jim's idea: find the curve the
                post is on, then read off its value at 48 hours.
  trees         gradient boosted trees on the post's recent growth (the last 10
                minutes, 1, 2 and 4 hours), its age, its views now, its tier and
                its author's followers. Trained on the older posts at every
                whole hour of age from 1 to 40.

Scores, all on the views still to come, on the test posts:
  median error  how far off a typical prediction is, as a factor.
  within 2x     the share of predictions within a factor of 2 of the truth.
  top 10%       pick the 10% of posts with the most predicted views to come.
                The share of the views that the true top 10% would have got.
                This is the selection the X run makes.

Writes results.json next to the data for the artifact.

    uv run src/scripts_jim/2026_11_21_feed_views_model/evaluate.py
"""

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression

DATA_DIR = Path.home() / "dev/data/goo-834"
TARGET_AGE_H = 48
DECISION_AGES_H = [2, 3, 6, 12, 24]
TRAIN_AGES_H = list(range(1, 41))
LOOKBACKS_H = [1 / 6, 1, 2, 4]
TEST_SHARE = 0.25
TOP_SHARE = 0.10
STRICT_TOP_SHARE = 0.02
MIN_TEST_POSTS = 30
X_EPOCH_MS = 1288834974657
LOG_CURVE_C_H = 0.3
MAX_READING_GAP_H = 0.5
BOOTSTRAP_ROUNDS = 1000
TIER_CODES = {"small": 0, "large": 1, "xl": 2}
RNG = np.random.default_rng(0)


def load() -> tuple[pd.DataFrame, pd.DataFrame]:
    views = pd.concat(pd.read_parquet(p) for p in sorted((DATA_DIR / "views").glob("*.parquet")))
    views["observed_at"] = pd.to_datetime(views["observed_at"], format="ISO8601")
    # A tweet id is an X "snowflake": its top bits are milliseconds since X's epoch.
    posted_ms = np.right_shift(views["tweet_id"].astype("int64").to_numpy(), 22) + X_EPOCH_MS
    views["posted_at"] = pd.to_datetime(posted_ms, unit="ms", utc=True)
    views["age_h"] = (views["observed_at"] - views["posted_at"]).dt.total_seconds() / 3600
    views = views.sort_values(["tweet_id", "age_h"])
    profiles = pd.concat([
        pd.read_parquet(DATA_DIR / "posts.parquet", columns=["tweet_id", "author_followers"]),
        pd.read_parquet(DATA_DIR / "feed_tweets.parquet", columns=["tweet_id", "author_followers"]),
    ]).drop_duplicates("tweet_id")
    return views, profiles.set_index("tweet_id")


def views_at(ages: np.ndarray, imps: np.ndarray, age: float) -> float | None:
    """Views at the given age, interpolated between the two nearest readings."""
    i = np.searchsorted(ages, age)
    if i == 0 or i == len(ages) or ages[i] - ages[i - 1] > MAX_READING_GAP_H:
        return None
    w = (age - ages[i - 1]) / (ages[i] - ages[i - 1])
    return imps[i - 1] + w * (imps[i] - imps[i - 1])


def example(tweet_id, posted_at, ages, imps, tiers, followers, v48, a) -> dict | None:
    now = views_at(ages, imps, a)
    if now is None:
        return None
    past = {lb: (views_at(ages, imps, a - lb) if lb < a else 0.0) for lb in LOOKBACKS_H}
    if any(v is None for v in past.values()):
        return None
    history = ages <= a
    return {
        "tweet_id": tweet_id, "posted_at": posted_at, "age": a, "now": now, "v48": v48,
        "tier": TIER_CODES[tiers[history][-1]], "followers": followers,
        "hist_ages": ages[history], "hist_imps": imps[history],
        **{f"past_{lb:.2f}": v for lb, v in past.items()},
    }


def series_by_post(views: pd.DataFrame, followers: pd.Series) -> dict:
    out = {}
    for tweet_id, s in views.groupby("tweet_id", sort=False):
        ages, imps = s.age_h.to_numpy(), s.impressions.to_numpy(dtype=float)
        v48 = views_at(ages, imps, TARGET_AGE_H)
        if v48 is not None:
            out[tweet_id] = (s.posted_at.iloc[0], ages, imps, s.tier.to_numpy(), followers.get(tweet_id, np.nan), v48)
    return out


def to_frame(rows: list) -> pd.DataFrame:
    ex = pd.DataFrame([r for r in rows if r is not None])
    ex["to_come"] = (ex.v48 - ex.now).clip(lower=0)
    return ex


def build_examples(series: dict, ages_wanted: list[float]) -> pd.DataFrame:
    return to_frame([example(tid, *rest[:5], rest[5], a) for tid, rest in series.items() for a in ages_wanted])


def sigmoid_in_log_time(t, log_l, log_c, k):
    return log_l - np.log1p((np.exp(log_c) / t) ** k)


def sigmoid_fit_v48(hist_ages: np.ndarray, hist_imps: np.ndarray, now: float, a: float) -> float:
    keep = (hist_ages > 0.05) & (hist_imps > 0)
    t, v = hist_ages[keep], hist_imps[keep]
    fallback = now * np.log1p(TARGET_AGE_H / LOG_CURVE_C_H) / np.log1p(a / LOG_CURVE_C_H)
    if len(t) < 4 or t[-1] - t[0] < 0.5:
        return fallback
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            params, _ = curve_fit(
                sigmoid_in_log_time, t, np.log(v), p0=[np.log(now * 2), np.log(a), 1.5],
                bounds=([np.log(now), np.log(0.05), 0.1], [np.log(now * 1000), np.log(500), 10]), maxfev=2000,
            )
        return float(np.exp(sigmoid_in_log_time(TARGET_AGE_H, *params)))
    except (RuntimeError, ValueError):
        return fallback


def growth_features(ex: pd.DataFrame) -> list:
    return [np.log1p((ex.now - ex[f"past_{lb:.2f}"]).clip(lower=0)) - np.log(lb) for lb in LOOKBACKS_H]


FEATURE_SETS = {
    "trees": lambda ex: np.column_stack([np.log(ex.age), np.log1p(ex.now), ex.tier, np.log1p(ex.followers), *growth_features(ex)]),
    "trees, no profile": lambda ex: np.column_stack([np.log(ex.age), np.log1p(ex.now), *growth_features(ex)]),
    "trees, no growth": lambda ex: np.column_stack([np.log(ex.age), np.log1p(ex.now), ex.tier, np.log1p(ex.followers)]),
}
# Jim's idea: the age, the views now and one or two more readings, in one formula.
FORMULA_NAMES = ["log age", "log views now", "log growth per hour over the last hour", "log growth per hour over the last 10 minutes"]


def formula_features(ex: pd.DataFrame) -> np.ndarray:
    g = growth_features(ex)
    return np.column_stack([np.log(ex.age), np.log1p(ex.now), g[1], g[0]])


def fit_models(train: pd.DataFrame) -> dict:
    target = np.log1p(train.to_come)
    models = {}
    for name, feats in FEATURE_SETS.items():
        models[name] = (HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=0).fit(feats(train), target), feats)
    models["formula"] = (LinearRegression().fit(formula_features(train), target), formula_features)
    models["formula per age"] = (PerAgeFormula().fit(train), lambda ex: ex)
    return models


class PerAgeFormula:
    """Jim's formula, fitted separately for each whole hour of age, on the
    training examples within a factor of 1.5 of that age. A prediction uses the
    formula of the nearest hour."""

    BAND = 1.5

    def fit(self, train: pd.DataFrame) -> "PerAgeFormula":
        self.models = {}
        for a in TRAIN_AGES_H:
            part = train[(train.age >= a / self.BAND) & (train.age <= a * self.BAND)]
            if len(part) < 50:
                continue
            self.models[a] = LinearRegression().fit(formula_features(part), np.log1p(part.to_come))
        return self

    def predict(self, ex: pd.DataFrame) -> np.ndarray:
        fitted = np.array(sorted(self.models))
        nearest = fitted[np.abs(ex.age.to_numpy()[:, None] - fitted[None, :]).argmin(axis=1)]
        out = np.empty(len(ex))
        for a in np.unique(nearest):
            mask = nearest == a
            out[mask] = self.models[a].predict(formula_features(ex[mask]))
        return out


def power_decay_to_come(test: pd.DataFrame) -> np.ndarray:
    """The growth rate falls as t^-k. k comes from the growth of the last hour
    against the hour before, and the rate is integrated to 48 hours."""
    a = test.age.to_numpy()
    rate_1h = test.now.to_numpy() - test["past_1.00"].to_numpy()
    rate_prev = test["past_1.00"].to_numpy() - test["past_2.00"].to_numpy()
    with np.errstate(divide="ignore", invalid="ignore"):
        k = np.log(np.clip(rate_prev, 1, None) / np.clip(rate_1h, 1, None)) / np.log((a - 0.5) / np.maximum(a - 1.5, 0.05))
    k = np.clip(np.nan_to_num(k, nan=1.0), 0.0, 5.0)
    t0 = a - 0.5
    with np.errstate(divide="ignore", invalid="ignore"):
        integral = np.where(np.isclose(k, 1.0), t0 * np.log(TARGET_AGE_H / a), t0**k * (TARGET_AGE_H ** (1 - k) - a ** (1 - k)) / (1 - k))
    return np.clip(rate_1h * integral, 0, None)


def predictions(test: pd.DataFrame, models: dict, with_sigmoid: bool = True) -> dict[str, np.ndarray]:
    a, now = test.age.to_numpy(), test.now.to_numpy()
    preds = {
        "velocity": now / a * (TARGET_AGE_H - a),
        "log curve": now * (np.log1p(TARGET_AGE_H / LOG_CURVE_C_H) / np.log1p(a / LOG_CURVE_C_H) - 1),
        "last hour's growth, kept": (now - test["past_1.00"].to_numpy()) * (TARGET_AGE_H - a),
        "power decay": power_decay_to_come(test),
    }
    if with_sigmoid:
        sig = np.array([sigmoid_fit_v48(r.hist_ages, r.hist_imps, r.now, r.age) for r in test.itertuples()])
        preds["sigmoid fit"] = np.clip(sig - now, 0, None)
    for name, (model, feats) in models.items():
        preds[name] = np.clip(np.expm1(model.predict(feats(test))), 0, None)
    return preds


def metrics(true: np.ndarray, pred: np.ndarray) -> dict[str, float]:
    log_err = np.abs(np.log1p(np.clip(pred, 0, None)) - np.log1p(true))
    n_top = max(1, int(round(TOP_SHARE * len(true))))
    picked = np.argsort(-pred)[:n_top]
    best = np.sort(true)[::-1][:n_top].sum()
    return {
        "median_error": float(np.exp(np.median(log_err))),
        "within_2x": float(np.mean(log_err <= np.log(2))),
        "top_capture": float(true[picked].sum() / best) if best > 0 else float("nan"),
    }


def bootstrap(true: np.ndarray, pred: np.ndarray) -> dict[str, list[float]]:
    draws = [metrics(true[idx], pred[idx]) for idx in (RNG.integers(0, len(true), len(true)) for _ in range(BOOTSTRAP_ROUNDS))]
    return {k: [float(np.percentile([d[k] for d in draws], 2.5)), float(np.percentile([d[k] for d in draws], 97.5))] for k in draws[0]}


SNAPSHOT_EVERY_H = 1
SNAPSHOT_MIN_AGE_H = 1
SNAPSHOT_MAX_AGE_H = 40


def is_test_post(tweet_id: str) -> bool:
    return int(tweet_id) % 4 == 0


def fixed_age_test(series: dict) -> dict:
    """Split by post: one post in four is a test post, whenever it was posted.
    A split by posting time is the honest one, but with 2.4 days of data it
    leaves no training post that was seen young: every post posted before the
    cutoff was already hours old when the recording started."""
    ex = build_examples(series, sorted(set(TRAIN_AGES_H) | set(DECISION_AGES_H)))
    test_mask = ex.tweet_id.map(is_test_post)
    train = ex[~test_mask & ex.age.isin(TRAIN_AGES_H)]
    test_all = ex[test_mask]
    print(f"Fixed-age test. {ex.tweet_id.nunique():,} posts reach 48 h. Train: {train.tweet_id.nunique():,} posts. Test: {test_all.tweet_id.nunique():,} posts.")
    models = fit_models(train)
    formula = models["formula"][0]
    print("Formula: log(1 + views to come) = " + f"{formula.intercept_:.2f} " + " ".join(f"{c:+.2f} x {n}" for c, n in zip(formula.coef_, FORMULA_NAMES)))
    out = {"split": "by post, one in four", "train_posts": int(train.tweet_id.nunique()), "test_posts": int(test_all.tweet_id.nunique()),
           "formula": {"intercept": float(formula.intercept_), "coefficients": dict(zip(FORMULA_NAMES, map(float, formula.coef_)))}, "ages": []}
    for a in DECISION_AGES_H:
        test = test_all[test_all.age == a]
        if len(test) < MIN_TEST_POSTS:
            continue
        true = test.to_come.to_numpy()
        entry = {"age": a, "n": len(test), "median_now": float(test.now.median()), "median_to_come": float(np.median(true)), "methods": {}}
        print(f"\nage {a} h: {len(test):,} test posts, median views now {test.now.median():,.0f}, median still to come {np.median(true):,.0f}")
        preds = predictions(test, models)
        for name, pred in preds.items():
            m, ci = metrics(true, pred), bootstrap(true, pred)
            entry["methods"][name] = {**m, "ci": ci}
            print(f"  {name:26s} median error x{m['median_error']:5.2f} [{ci['median_error'][0]:.2f}-{ci['median_error'][1]:.2f}]  within 2x {m['within_2x']:.0%}")
        entry["scatter"] = {name: [[float(t), float(p)] for t, p in zip(true, preds[name])] for name in ["velocity", "log curve", "last hour's growth, kept", "trees"]}
        out["ages"].append(entry)
    return out


def snapshot_test(series: dict) -> dict:
    """The X run's choice: at one moment, which posts in the feed will get the
    most views from now on? Posts of every age compete. Split by post: the
    models train on three quarters of the posts, and the snapshots rank
    the other quarter. Every 2 hours of the recording is one snapshot."""
    ids = np.array(list(series))
    test_ids = {t for t in ids if is_test_post(t)}
    train = build_examples({t: v for t, v in series.items() if t not in test_ids}, TRAIN_AGES_H)
    models = fit_models(train)
    test_series = {t: v for t, v in series.items() if t in test_ids}
    first = min(v[0] for v in test_series.values()) + pd.Timedelta(hours=SNAPSHOT_MAX_AGE_H)
    last = max(v[0] for v in test_series.values()) + pd.Timedelta(hours=SNAPSHOT_MIN_AGE_H)
    rows = []
    for k, t in enumerate(pd.date_range(first, last, freq=f"{SNAPSHOT_EVERY_H}h")):
        for tid, (posted_at, *rest) in test_series.items():
            a = (t - posted_at).total_seconds() / 3600
            if SNAPSHOT_MIN_AGE_H <= a <= SNAPSHOT_MAX_AGE_H:
                r = example(tid, posted_at, *rest[:4], rest[4], a)
                if r is not None:
                    rows.append({**r, "snapshot": k})
    ex = to_frame(rows)
    print(f"\nSnapshot test: {ex.snapshot.nunique()} snapshots, {len(ex) / ex.snapshot.nunique():.0f} held-out posts each on average, ages {SNAPSHOT_MIN_AGE_H} to {SNAPSHOT_MAX_AGE_H} h")
    preds = predictions(ex, models, with_sigmoid=False)
    # Production ranks by velocity itself, not by velocity extended to 48 h.
    preds["velocity (production order)"] = ex.now.to_numpy() / ex.age.to_numpy()
    out = {"snapshots": int(ex.snapshot.nunique()), "posts_per_snapshot": float(len(ex) / ex.snapshot.nunique()), "methods": {}}
    for name, pred in preds.items():
        per_snapshot = {"top10": [], "top2": [], "spearman": []}
        for _, part in ex.assign(pred=pred).groupby("snapshot"):
            true, p = part.to_come.to_numpy(), part.pred.to_numpy()
            per_snapshot["top10"].append(capture(true, p, TOP_SHARE))
            per_snapshot["top2"].append(capture(true, p, STRICT_TOP_SHARE))
            per_snapshot["spearman"].append(spearmanr(p, true).statistic)
        entry = {}
        for key, values in per_snapshot.items():
            values = np.array(values)
            boots = [np.mean(RNG.choice(values, len(values))) for _ in range(BOOTSTRAP_ROUNDS)]
            entry[key] = {"mean": float(values.mean()), "ci": [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))]}
        out["methods"][name] = entry
        print(f"  {name:28s} top 10% {entry['top10']['mean']:.0%} [{entry['top10']['ci'][0]:.0%}-{entry['top10']['ci'][1]:.0%}]  top 2% {entry['top2']['mean']:.0%} [{entry['top2']['ci'][0]:.0%}-{entry['top2']['ci'][1]:.0%}]  rank corr {entry['spearman']['mean']:.3f}")
    return out


def capture(true: np.ndarray, pred: np.ndarray, share: float) -> float:
    n_top = max(1, int(round(share * len(true))))
    best = np.sort(true)[::-1][:n_top].sum()
    return float(true[np.argsort(-pred)[:n_top]].sum() / best) if best > 0 else float("nan")


def main() -> None:
    views, profiles = load()
    series = series_by_post(views, profiles.author_followers)
    results = {"posts": len(series), "data_end": str(views.observed_at.max()), "fixed_age": fixed_age_test(series), "snapshot": snapshot_test(series)}
    sample = [t for t, v in series.items() if v[1][0] < 2][:60]
    results["curves"] = {str(t): [[round(float(a), 2), float(i)] for a, i in zip(series[t][1][::3], series[t][2][::3])] for t in sample}
    (DATA_DIR / "results.json").write_text(json.dumps(results))
    print(f"\nwrote {DATA_DIR / 'results.json'}")

if __name__ == "__main__":
    main()
