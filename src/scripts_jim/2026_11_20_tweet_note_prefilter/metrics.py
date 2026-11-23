"""How a filter scores on the backtest (GOO-835).

A filter gives every tweet a score, where higher means "more likely to end up
with a helpful note". A threshold turns the score into pass or drop. Two
numbers describe one threshold:

- recall: the share of helpful-note tweets that pass. Dropping one of those
  loses a note that could have been helpful, so we want this high.
- pass rate: the share of all tweets that pass. Every dropped tweet saves one
  expensive check, so we want this low.

We fix the recall (90% and 95%) and report the pass rate the filter needs for
it. The lift is the helpful share among passed tweets divided by the helpful
share overall: how much richer the note writers' input gets. AUC is the
standard area under the ROC curve, the chance that a random helpful-note tweet
scores above a random other tweet.
"""

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

TARGET_RECALLS = (0.90, 0.95)


def pass_rate_at_recall(scores: np.ndarray, labels: np.ndarray, recall: float) -> tuple[float, float]:
    positive_scores = np.sort(scores[labels])
    threshold = positive_scores[int(np.floor((1 - recall) * len(positive_scores)))]
    return float(np.mean(scores >= threshold)), float(threshold)


def describe_filter(name: str, scores, labels) -> dict:
    scores = np.asarray(scores, dtype=float)
    labels = np.asarray(labels, dtype=bool)
    row = {"filter": name, "tweets": len(labels), "helpful": int(labels.sum()), "auc": roc_auc_score(labels, scores)}
    for recall in TARGET_RECALLS:
        pass_rate, _ = pass_rate_at_recall(scores, labels, recall)
        row[f"pass@{int(recall * 100)}"] = pass_rate
        row[f"lift@{int(recall * 100)}"] = recall / pass_rate
    return row


def tweet_outcome(df: pd.DataFrame) -> pd.Series:
    """Sorts each tweet into one of four outcomes. "stalemate" means notes were
    written and at least one got 30 or more ratings, yet none became helpful.
    That is the case Jim described: enough raters looked, but they split."""
    return pd.Series(np.select(
        [df["helpful"], df["attended_unhelpful_notes"] > 0, df["notes"] > 0],
        ["helpful", "stalemate", "noted, little attention"],
        "no notes",
    ), index=df.index)


def pass_rates_by_outcome(scores, df: pd.DataFrame, recall: float = TARGET_RECALLS[0]) -> pd.Series:
    """At the threshold that keeps `recall` of the helpful-note tweets, the
    share of each outcome that passes, and the share of views that pass."""
    scores = np.asarray(scores, dtype=float)
    _, threshold = pass_rate_at_recall(scores, df["helpful"].to_numpy(), recall)
    passed = scores >= threshold
    rates = pd.Series(passed, index=df.index).groupby(tweet_outcome(df)).mean()
    views = df["impressions"].astype(float).to_numpy()
    helpful = df["helpful"].to_numpy()
    rates["views of helpful-note tweets"] = views[passed & helpful].sum() / views[helpful].sum()
    return rates


def describe_binary_filter(name: str, passed, labels) -> dict:
    passed = np.asarray(passed, dtype=bool)
    labels = np.asarray(labels, dtype=bool)
    recall = passed[labels].mean()
    pass_rate = passed.mean()
    return {"filter": name, "tweets": len(labels), "helpful": int(labels.sum()), "recall": recall, "pass_rate": pass_rate, "lift": recall / pass_rate}


def print_table(rows: list[dict]) -> None:
    print(pd.DataFrame(rows).round(3).to_string(index=False))
