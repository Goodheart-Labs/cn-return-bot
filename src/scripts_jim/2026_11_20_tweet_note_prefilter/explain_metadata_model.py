"""What did the metadata model learn, and which tweets does it let through? (GOO-835)

Trains the metadata model on the development weeks, as combine.py does, and
looks at the test weeks:
- permutation importance: how much the test AUC falls when one feature's
  values are shuffled across tweets,
- partial dependence: the model's average score when one feature is set to a
  value for every tweet, with the other features left as they are,
- pass rates: which share of each kind of tweet passes at the threshold that
  keeps 90% of helpful-note tweets.

Run from the worktree root:
  uv run --with pandas --with pyarrow --with scikit-learn src/scripts_jim/2026_11_20_tweet_note_prefilter/explain_metadata_model.py
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.inspection import partial_dependence, permutation_importance

sys.path.insert(0, str(Path(__file__).parent))
from features import DATA_DIR, fit_metadata_model, metadata_features  # noqa: E402
from metrics import tweet_outcome  # noqa: E402

TARGET_RECALL = 0.9
IMPORTANCE_REPEATS = 5
TOP_FEATURES_FOR_DEPENDENCE = 8
QUANTILE_BINS = 5
EXAMPLES = 10

pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 30)


def threshold_for_recall(scores: np.ndarray, labels: np.ndarray, recall: float) -> float:
    positive_scores = np.sort(scores[labels])
    return positive_scores[int(np.floor((1 - recall) * len(positive_scores)))]


def pass_rate_table(passed: pd.Series, groups: pd.Series, labels: pd.Series) -> pd.DataFrame:
    return pd.DataFrame({
        "tweets": groups.value_counts(),
        "helpful_rate": labels.groupby(groups).mean(),
        "pass_rate": passed.groupby(groups).mean(),
    }).round(3)


def main() -> None:
    df = pd.read_parquet(DATA_DIR / "dataset.parquet")
    features = metadata_features(df)
    dev = (df["split"] == "dev").to_numpy()
    model = fit_metadata_model(features[dev], df.loc[dev, "helpful"])
    test_features, test_labels = features[~dev], df.loc[~dev, "helpful"].to_numpy()
    scores = model.predict_proba(test_features)[:, 1]

    importance = permutation_importance(model, test_features, test_labels, scoring="roc_auc", n_repeats=IMPORTANCE_REPEATS, random_state=0)
    ranked = pd.Series(importance.importances_mean, index=features.columns).sort_values(ascending=False)
    print("AUC lost when the feature is shuffled:")
    print(ranked.round(4).to_string())

    for name in ranked.index[:TOP_FEATURES_FOR_DEPENDENCE]:
        dependence = partial_dependence(model, test_features, [name], grid_resolution=8, percentiles=(0.05, 0.95))
        grid = ", ".join(f"{value:.3g}: {score:.3f}" for value, score in zip(dependence["grid_values"][0], dependence["average"][0]))
        print(f"\n{name} -> average score: {grid}")

    threshold = threshold_for_recall(scores, test_labels, TARGET_RECALL)
    test = df[~dev].assign(passed=scores >= threshold, outcome=tweet_outcome(df[~dev]))
    test_features = test_features.assign(passed=test["passed"].to_numpy())
    print(f"\nThreshold {threshold:.3f}, pass rate {test['passed'].mean():.3f}")

    labels = test["helpful"]
    media = np.select([test["has_video"], test["has_photo"]], ["video", "photo"], "text only")
    kind = np.select([test_features["is_quote"] == 1, test_features["is_reply"] == 1], ["quote", "reply"], "original")
    tables = {
        "feed tier": test["feed_size"],
        "media": pd.Series(media, index=test.index),
        "kind": pd.Series(kind, index=test.index),
        "outcome group": test["outcome"],
        "author had a helpful-note tweet before": test["author_prior_helpful"] > 0,
    }
    for column in ["log_followers", "log_velocity", "like_ratio", "reply_ratio", "quote_ratio", "age_hours", *[c for c in features.columns if c.startswith("neighbour")]]:
        tables[f"{column} quintile"] = pd.qcut(test_features[column], QUANTILE_BINS, duplicates="drop").astype(str)
    for name, groups in tables.items():
        print(f"\n{name}:")
        print(pass_rate_table(test["passed"], groups, labels).to_string())

    print("\nMedians of passed and dropped tweets:")
    print(test_features.groupby("passed").median().T.round(4).to_string())

    test = test.assign(score=scores)
    sample_columns = ["score", "helpful", "feed_size", "author_handle", "author_followers", "text"]
    for title, rows in [("Highest scores", test.nlargest(EXAMPLES, "score")), ("Lowest scores", test.nsmallest(EXAMPLES, "score")), ("Random dropped", test[~test["passed"]].sample(EXAMPLES, random_state=0))]:
        print(f"\n{title}:")
        print(rows[sample_columns].assign(text=rows["text"].str.slice(0, 110).str.replace("\n", " ")).to_string(index=False))


if __name__ == "__main__":
    main()
