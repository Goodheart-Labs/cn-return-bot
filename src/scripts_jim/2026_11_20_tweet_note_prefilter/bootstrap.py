"""How sure are we that Haiku helps on top of the metadata model? (GOO-835)

Resamples the 4,000 test tweets with replacement and recomputes, for each
resample, the pass rate at 90% recall of the metadata model and of the
combined filter. Prints the median difference and a 90% interval.

Run from the worktree root:
  uv run --with pandas --with pyarrow --with scikit-learn --with httpx --with python-dotenv src/scripts_jim/2026_11_20_tweet_note_prefilter/bootstrap.py
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(Path(__file__).parent))
from combine import combined_inputs, metadata_scores  # noqa: E402
from evaluate import RUNS_DIR, load_run  # noqa: E402
from features import DATA_DIR  # noqa: E402
from metrics import pass_rate_at_recall  # noqa: E402
from report import CHOSEN_DEV_RUN, CHOSEN_TEST_RUN  # noqa: E402

RESAMPLES = 2000
RECALL = 0.90


def main() -> None:
    df = pd.read_parquet(DATA_DIR / "dataset.parquet")
    labels = df.set_index("tweet_id")["helpful"]
    metadata = metadata_scores(df)
    dev_run, test_run = (load_run(RUNS_DIR / f"{name}.jsonl") for name in (CHOSEN_DEV_RUN, CHOSEN_TEST_RUN))
    combiner = LogisticRegression().fit(combined_inputs(dev_run, metadata), labels.loc[dev_run["tweet_id"]].to_numpy())
    inputs = combined_inputs(test_run, metadata)
    metadata_only, combined = inputs[:, 0], combiner.predict_proba(inputs)[:, 1]
    test_labels = labels.loc[test_run["tweet_id"]].to_numpy()
    rng = np.random.default_rng(0)
    differences = []
    for _ in range(RESAMPLES):
        sample = rng.integers(0, len(test_labels), len(test_labels))
        metadata_pass, _ = pass_rate_at_recall(metadata_only[sample], test_labels[sample], RECALL)
        combined_pass, _ = pass_rate_at_recall(combined[sample], test_labels[sample], RECALL)
        differences.append(metadata_pass - combined_pass)
    low, median, high = np.percentile(differences, [5, 50, 95])
    print(f"Pass rate at {RECALL:.0%} recall, metadata minus combined: median {median:.3f}, 90% interval {low:.3f} to {high:.3f}")
    print(f"Share of resamples where the combined filter passes fewer tweets: {np.mean(np.array(differences) > 0):.3f}")


if __name__ == "__main__":
    main()
