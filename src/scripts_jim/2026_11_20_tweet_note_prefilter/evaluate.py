"""Score Haiku filter runs against the labels (GOO-835).

For each run file in runs/, prints the backtest numbers from metrics.py plus
what the run cost: tokens, searches and dollars per tweet. Tweets whose call
failed count as passed, because a filter that cannot answer should let the
tweet through.

Run from the worktree root:
  uv run --with pandas --with pyarrow --with scikit-learn src/scripts_jim/2026_11_20_tweet_note_prefilter/evaluate.py [run name ...]
"""

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from metrics import describe_filter, print_table  # noqa: E402

DATA_DIR = Path("/home/jim/dev/data/goo-835")
RUNS_DIR = DATA_DIR / "runs"
FAILED_CALL_PROBABILITY = 1.0


def load_run(path: Path) -> pd.DataFrame:
    run = pd.DataFrame(map(json.loads, open(path))).drop_duplicates("tweet_id", keep="last")
    if "error" not in run:
        run["error"] = None
    run["probability"] = run["probability"].fillna(FAILED_CALL_PROBABILITY)
    return run


def describe_run(name: str, run: pd.DataFrame, labels: pd.DataFrame) -> dict:
    joined = run.merge(labels, on="tweet_id")
    row = describe_filter(name, joined["probability"], joined["helpful"])
    row.update({
        "errors": int(joined["error"].notna().sum()),
        "in_tokens": joined["prompt_tokens"].mean(),
        "out_tokens": joined["completion_tokens"].mean(),
        "search_share": (joined["searches"] > 0).mean(),
        "usd_per_1k": joined["cost"].mean() * 1000,
    })
    return row


def main() -> None:
    labels = pd.read_parquet(DATA_DIR / "dataset.parquet", columns=["tweet_id", "helpful"])
    names = sys.argv[1:] or sorted(path.stem for path in RUNS_DIR.glob("*.jsonl"))
    print_table([describe_run(name, load_run(RUNS_DIR / f"{name}.jsonl"), labels) for name in names])


if __name__ == "__main__":
    main()
