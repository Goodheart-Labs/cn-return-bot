"""How well does the Claude Code prompt on Haiku work as a filter? (GOO-835)

Reads the runs of claude_filter.ts. A tweet passes when Haiku wrote a note.
The sample oversamples positives, so the pass rate is put back together from
the two halves: the share of helpful-note tweets that pass (the recall), and
the share of the other tweets that pass, weighted by how common each half is
among the simple-bot test tweets the sample was drawn from.

For comparison, the metadata model's recall on all test tweets at the same
pass rate.

Run from the worktree root:
  uv run --with pandas --with pyarrow --with scikit-learn src/scripts_jim/2026_11_20_tweet_note_prefilter/claude_filter_report.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from combine import metadata_scores  # noqa: E402
from features import DATA_DIR  # noqa: E402
from metrics import tweet_outcome  # noqa: E402

ARMS = ["haiku_medium", "haiku_medium_lean"]
SAMPLE_BOT = "simple-bot"


def read_answer(arm: str, tweet_id: str) -> dict | None:
    """The answer file, read again here, because the first runs of
    claude_filter.ts did not yet allow for a stray tag after the object."""
    path = DATA_DIR / "claude_runs" / arm / tweet_id / "answer.json"
    if not path.exists():
        return None
    text = path.read_text()
    try:
        return json.loads(text[text.find("{"):text.rfind("}") + 1])
    except json.JSONDecodeError:
        return None


def decision(answer: dict | None) -> str:
    return "note" if answer and answer.get("note") else "no_note" if answer and answer.get("no_note") else "none"


def load_arm(arm: str) -> pd.DataFrame:
    path = DATA_DIR / "runs" / f"claude_{arm}.jsonl"
    run = pd.DataFrame(map(json.loads, open(path))).drop_duplicates("tweet_id", keep="last")
    run["decision"] = [decision(read_answer(arm, tweet_id)) for tweet_id in run["tweet_id"]]
    return run


def metadata_recall_at_pass_rate(df: pd.DataFrame, metadata: pd.Series, pass_rate: float) -> float:
    test = df[df["split"] == "test"]
    scores = metadata.loc[test["tweet_id"]].to_numpy()
    threshold = np.quantile(scores, 1 - pass_rate)
    return float(np.mean(scores[test["helpful"].to_numpy()] >= threshold))


def main() -> None:
    df = pd.read_parquet(DATA_DIR / "dataset.parquet")
    df["outcome"] = tweet_outcome(df)
    pool = df[(df["split"] == "test") & (df["bot"] == SAMPLE_BOT)]
    positive_share = pool["helpful"].mean()
    metadata = metadata_scores(df)
    by_id = df.set_index("tweet_id")
    rows = []
    for arm in ARMS:
        run = load_arm(arm)
        run["passed"] = run["decision"] == "note"
        run["outcome"] = by_id.loc[run["tweet_id"], "outcome"].to_numpy()
        recall = run.loc[run["helpful"], "passed"].mean()
        negative_pass = run.loc[~run["helpful"], "passed"].mean()
        pass_rate = positive_share * recall + (1 - positive_share) * negative_pass
        tools = pd.DataFrame(run["tools"].tolist()).fillna(0)
        rows.append({
            "arm": arm,
            "tweets": len(run),
            "no answer": int((run["decision"] == "none").sum()),
            "recall": recall,
            "pass rate": pass_rate,
            "metadata recall at that pass rate": metadata_recall_at_pass_rate(df, metadata, pass_rate),
            **{f"pass: {group}": share for group, share in run[~run["helpful"]].groupby("outcome")["passed"].mean().items()},
            "usd per tweet": run["cost_usd"].mean(),
            "seconds per tweet": run["seconds"].mean(),
            "web searches per tweet": tools.get("WebSearch", pd.Series(0)).mean(),
            "share with any web search": (tools.get("WebSearch", pd.Series(0)) > 0).mean(),
        })
    print(f"positive share among simple-bot test tweets: {positive_share:.3f}")
    print(pd.DataFrame(rows).set_index("arm").T.round(3).to_string())


if __name__ == "__main__":
    main()
