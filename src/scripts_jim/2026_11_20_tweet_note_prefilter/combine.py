"""Does Haiku add anything to the free metadata model? (GOO-835)

The combined filter is a logistic regression on two inputs: the metadata
model's score and Haiku's probability, both on the log-odds scale. Every
number is measured on the same tweets, so the rows compare fairly:

- On development tweets, the metadata score comes from a model that did not
  see that week (5 folds, one per block of development days), and the
  combination is fitted with 5-fold cross-validation on the run's tweets.
- On test tweets, the metadata model is trained on all development tweets, and
  the combination is fitted on the development run of the same variant.

Run from the worktree root:
  uv run --with pandas --with pyarrow --with scikit-learn src/scripts_jim/2026_11_20_tweet_note_prefilter/combine.py <dev run> [<test run>]
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_predict

sys.path.insert(0, str(Path(__file__).parent))
from evaluate import RUNS_DIR, load_run  # noqa: E402
from features import DATA_DIR, fit_metadata_model, metadata_features  # noqa: E402
from metrics import describe_filter, print_table  # noqa: E402

DEV_FOLDS = 5
PROBABILITY_FLOOR = 1e-3


def log_odds(p) -> np.ndarray:
    p = np.clip(np.asarray(p, dtype=float), PROBABILITY_FLOOR, 1 - PROBABILITY_FLOOR)
    return np.log(p / (1 - p))


def metadata_scores(df: pd.DataFrame) -> pd.Series:
    """Out-of-fold scores on development tweets, and scores from a model
    trained on all development tweets for test tweets."""
    features = metadata_features(df)
    dev = (df["split"] == "dev").to_numpy()
    scores = np.zeros(len(df))
    dev_positions = np.flatnonzero(dev)
    folds = np.array_split(dev_positions, DEV_FOLDS)
    for fold in folds:
        train = np.setdiff1d(dev_positions, fold)
        model = fit_metadata_model(features.iloc[train], df["helpful"].iloc[train])
        scores[fold] = model.predict_proba(features.iloc[fold])[:, 1]
    model = fit_metadata_model(features[dev], df.loc[dev, "helpful"])
    scores[~dev] = model.predict_proba(features[~dev])[:, 1]
    return pd.Series(scores, index=df["tweet_id"])


def combined_inputs(run: pd.DataFrame, metadata: pd.Series) -> np.ndarray:
    return np.column_stack([log_odds(metadata.loc[run["tweet_id"]].to_numpy()), log_odds(run["probability"])])


def main() -> None:
    df = pd.read_parquet(DATA_DIR / "dataset.parquet")
    labels = df.set_index("tweet_id")["helpful"]
    metadata = metadata_scores(df)
    dev_name = sys.argv[1]
    dev_run = load_run(RUNS_DIR / f"{dev_name}.jsonl")
    dev_labels = labels.loc[dev_run["tweet_id"]].to_numpy()
    dev_inputs = combined_inputs(dev_run, metadata)
    combiner = LogisticRegression()
    dev_combined = cross_val_predict(combiner, dev_inputs, dev_labels, cv=DEV_FOLDS, method="predict_proba")[:, 1]
    rows = [
        describe_filter(f"{dev_name}: metadata only", dev_inputs[:, 0], dev_labels),
        describe_filter(f"{dev_name}: model only", dev_inputs[:, 1], dev_labels),
        describe_filter(f"{dev_name}: combined", dev_combined, dev_labels),
    ]
    combiner.fit(dev_inputs, dev_labels)
    print(f"combination weights (metadata, model): {combiner.coef_.round(2).tolist()}")
    if len(sys.argv) > 2:
        test_name = sys.argv[2]
        test_run = load_run(RUNS_DIR / f"{test_name}.jsonl")
        test_labels = labels.loc[test_run["tweet_id"]].to_numpy()
        test_inputs = combined_inputs(test_run, metadata)
        rows += [
            describe_filter(f"{test_name}: metadata only", test_inputs[:, 0], test_labels),
            describe_filter(f"{test_name}: model only", test_inputs[:, 1], test_labels),
            describe_filter(f"{test_name}: combined", combiner.predict_proba(test_inputs)[:, 1], test_labels),
        ]
    print_table(rows)


if __name__ == "__main__":
    main()
