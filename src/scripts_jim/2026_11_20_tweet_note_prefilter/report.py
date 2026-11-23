"""Collect every number the write-up shows into report_data.json (GOO-835).

Run from the worktree root after the runs exist:
  uv run --with pandas --with pyarrow --with scikit-learn --with httpx --with python-dotenv \\
    src/scripts_jim/2026_11_20_tweet_note_prefilter/report.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(Path(__file__).parent))
from baselines import existing_prefilter_rows  # noqa: E402
from combine import combined_inputs, metadata_scores  # noqa: E402
from evaluate import RUNS_DIR, describe_run, load_run  # noqa: E402
from features import DATA_DIR  # noqa: E402
from metrics import describe_filter, pass_rates_by_outcome, tweet_outcome  # noqa: E402

OUT_PATH = Path(__file__).parent / "report_data.json"
CHOSEN_DEV_RUN = "v2_neighbours_medium_dev_1500_0"
CHOSEN_TEST_RUN = "v2_neighbours_medium_test_4000_0"
DEV_RUNS = {
    "v1_plain_low_dev_1500_0": "Prompt v1, tweet only",
    "v1_neighbours_low_dev_1500_0": "Prompt v1, with similar tweets",
    "v2_plain_low_dev_1500_0": "Prompt v2, tweet only",
    "v2_neighbours_off_dev_1500_0": "Prompt v2, similar tweets, no thinking",
    "v2_neighbours_low_dev_1500_0": "Prompt v2, similar tweets, low thinking",
    "v2_neighbours_medium_dev_1500_0": "Prompt v2, similar tweets, medium thinking",
    "v2_neighbours_search_low_dev_1500_0": "Prompt v2, similar tweets, web search allowed",
    "v3_neighbours_off_dev_1500_0": "Prompt v3 (five part questions), similar tweets",
    "claude-sonnet-5.5_v2_neighbours_low_dev_1500_0": "Sonnet 5.5 instead of Haiku, prompt v2, similar tweets",
}
CURVE_RECALLS = np.round(np.arange(0.5, 1.0001, 0.02), 2)


def curve(scores, labels) -> list[dict]:
    scores, labels = np.asarray(scores, dtype=float), np.asarray(labels, dtype=bool)
    positive_scores = np.sort(scores[labels])
    points = []
    for recall in CURVE_RECALLS:
        threshold = positive_scores[min(int(np.floor((1 - recall) * len(positive_scores))), len(positive_scores) - 1)]
        points.append({"recall": float(recall), "pass_rate": float(np.mean(scores >= threshold))})
    return points


def clean(value):
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, (np.floating, float)):
        return None if np.isnan(value) else round(float(value), 4)
    if isinstance(value, np.integer):
        return int(value)
    return value


def main() -> None:
    df = pd.read_parquet(DATA_DIR / "dataset.parquet")
    by_id = df.set_index("tweet_id")
    labels = df[["tweet_id", "helpful"]]
    metadata = metadata_scores(df)

    outcome = tweet_outcome(df)
    dataset = {
        "tweets": len(df),
        "by_split": df.groupby("split").agg(tweets=("tweet_id", "size"), helpful=("helpful", "mean")).reset_index().to_dict("records"),
        "outcome_shares": outcome.value_counts(normalize=True).to_dict(),
        "helpful_by_tier": df.groupby("feed_size")["helpful"].agg(["mean", "size"]).reset_index().to_dict("records"),
    }

    dev_rows = []
    for name, label in DEV_RUNS.items():
        row = describe_run(name, load_run(RUNS_DIR / f"{name}.jsonl"), labels)
        row["label"] = label
        dev_rows.append(row)

    dev_run = load_run(RUNS_DIR / f"{CHOSEN_DEV_RUN}.jsonl")
    test_run = load_run(RUNS_DIR / f"{CHOSEN_TEST_RUN}.jsonl")
    dev_labels = by_id.loc[dev_run["tweet_id"], "helpful"].to_numpy()
    test_labels = by_id.loc[test_run["tweet_id"], "helpful"].to_numpy()
    combiner = LogisticRegression().fit(combined_inputs(dev_run, metadata), dev_labels)
    test_inputs = combined_inputs(test_run, metadata)
    test_scores = {
        "metadata only": test_inputs[:, 0],
        "Haiku only": test_inputs[:, 1],
        "Haiku and metadata combined": combiner.predict_proba(test_inputs)[:, 1],
    }
    test_rows = [describe_filter(name, scores, test_labels) for name, scores in test_scores.items()]
    test_cost = describe_run(CHOSEN_TEST_RUN, test_run, labels)
    whole_test = df[df["split"] == "test"]
    report = {
        "dataset": dataset,
        "existing_prefilter": existing_prefilter_rows(df),
        "dev_runs": dev_rows,
        "test": test_rows,
        "test_cost": test_cost,
        "test_metadata_all_tweets": describe_filter("metadata only, every test tweet", metadata.loc[whole_test["tweet_id"]].to_numpy(), whole_test["helpful"]),
        "test_curves": {name: curve(scores, test_labels) for name, scores in test_scores.items()},
        "test_outcome_pass_rates": {name: pass_rates_by_outcome(scores, by_id.loc[test_run["tweet_id"]]).to_dict() for name, scores in test_scores.items()},
        "combiner_weights": combiner.coef_.tolist(),
    }
    OUT_PATH.write_text(json.dumps(clean(report), indent=1))
    print(json.dumps(clean({"test": test_rows, "outcomes": report["test_outcome_pass_rates"], "cost": test_cost}), indent=1))


if __name__ == "__main__":
    main()
