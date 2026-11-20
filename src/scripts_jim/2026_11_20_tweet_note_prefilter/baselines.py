"""Baselines for the tweet filter: the existing prefilter and a metadata model (GOO-835).

1. The DeepSeek note-needed prefilter (`src/pipeline/prefilter/`) already
   judged most simple-bot tweets until 2026-11-04. Its verdict is a yes or no,
   so it is one point: how many helpful-note tweets it let through, and how
   many tweets it let through overall.
2. A gradient-boosted tree model on signals that cost nothing: the feed tier,
   velocity, age, follower count, engagement ratios, media flags, and how often
   the author's earlier tweets got helpful notes. It is trained on the
   development weeks and scored on the test weeks.

Run from the worktree root:
  uv run --with pandas --with pyarrow --with scikit-learn src/scripts_jim/2026_11_20_tweet_note_prefilter/baselines.py
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from features import DATA_DIR, fit_metadata_model, metadata_features  # noqa: E402
from metrics import describe_binary_filter, describe_filter, print_table  # noqa: E402


def existing_prefilter_rows(df: pd.DataFrame) -> list[dict]:
    judged = df[df["prefilter_needs_note"].notna()]
    rows = []
    for split, part in judged.groupby("split"):
        row = describe_binary_filter(f"deepseek prefilter ({split})", part["prefilter_needs_note"] == "true", part["helpful"])
        row["cost_per_tweet"] = part["prefilter_cost"].mean()
        rows.append(row)
    return rows


def metadata_model_scores(df: pd.DataFrame, columns: list[str] | None = None) -> np.ndarray:
    features = metadata_features(df)
    if columns:
        features = features[columns]
    dev = df["split"] == "dev"
    return fit_metadata_model(features[dev], df.loc[dev, "helpful"]).predict_proba(features[~dev])[:, 1]


def main() -> None:
    df = pd.read_parquet(DATA_DIR / "dataset.parquet")
    print("Existing DeepSeek prefilter, on the tweets it judged:")
    print_table(existing_prefilter_rows(df))

    test = df[df["split"] == "test"]
    rows = [describe_filter("metadata model, all features", metadata_model_scores(df), test["helpful"])]
    for name, columns in {
        "feed tier only": ["tier"],
        "velocity and views only": ["log_velocity", "log_impressions", "age_hours"],
        "author history only": ["author_prior_tweets", "author_prior_helpful", "author_prior_noted", "author_prior_helpful_rate"],
        "engagement ratios only": ["like_ratio", "reply_ratio", "quote_ratio", "retweet_ratio", "bookmark_ratio"],
        "similar earlier tweets only": ["neighbour_helpful_rate", "neighbour_noted_rate", "top_neighbour_similarity", "top_neighbour_helpful"],
    }.items():
        rows.append(describe_filter(f"metadata model, {name}", metadata_model_scores(df, columns), test["helpful"]))
    print("\nMetadata models, trained on development and scored on test:")
    print_table(rows)


if __name__ == "__main__":
    main()
