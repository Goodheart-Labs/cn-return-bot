# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy"]
# ///
"""Builds the (tweet, note) pair table from ./data/*.parquet. No DB, no LLM.

One row per submitted, matured note. `build_pairs()` is imported by rate.py and
evaluate.py so the two agree on the unit exactly.

The only columns rate.py is allowed to read are tweet_text / author_handle /
note_text / source_url. Everything else in this frame (labels, dates, scores)
exists for evaluate.py and is never shown to the model.
"""
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
H_STATUS, NH_STATUS = "CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL"
URL_RX = re.compile(r"https?://\S+")


def split_urls(s):
    """pipeline_runs.source_url is one TEXT field; notes sometimes carry several."""
    if not isinstance(s, str) or not s.strip():
        return []
    found = URL_RX.findall(s)
    if found:
        return [u.rstrip(").,;'\"") for u in found]
    return [p.strip() for p in re.split(r"[\s,;]+", s) if p.strip()]


def build_pairs():
    meta = json.loads((DATA / "pull_meta.json").read_text())
    pulled_at = pd.Timestamp(meta["pulled_at_utc"])
    cutoff = pd.Timestamp(meta["maturity_cutoff_utc"])
    notes = pd.read_parquet(DATA / "notes.parquet")
    runs = pd.read_parquet(DATA / "pipeline_runs_text.parquet")
    eng = pd.read_parquet(DATA / "materiality_engages.parquet")
    feed = pd.read_parquet(DATA / "feed_tweets_text.parquet")
    tw = pd.read_parquet(DATA / "tweets_text.parquet")

    notes["when"] = notes["submitted_at"].fillna(notes["first_seen_at"])
    df = notes[notes["when"] < cutoff].copy()
    df["H"] = (df["cn_status"] == H_STATUS).astype(int)
    df["NH"] = (df["cn_status"] == NH_STATUS).astype(int)
    df["rated"] = df["H"] + df["NH"]

    # --- submitting run, by note_id (the sibling screen found the tweet_id
    #     fallback matched nothing, so note_id only, and we count the misses).
    by_note = runs.dropna(subset=["note_id"]).sort_values("created_at").drop_duplicates("note_id", keep="last")
    by_note = by_note.set_index("note_id")
    df["run_id"] = df["note_id"].map(by_note["run_id"])
    df["note_text"] = df["note_id"].map(by_note["note_text"])
    df["source_url"] = df["note_id"].map(by_note["source_url"])
    df["run_created_at"] = df["note_id"].map(by_note["created_at"])

    # --- tweet text: feed_tweets first, then tweets.
    f = feed.drop_duplicates("tweet_id").set_index("tweet_id")
    t = tw.drop_duplicates("tweet_id").set_index("tweet_id")
    ft = df["tweet_id"].map(f["text"])
    tt = df["tweet_id"].map(t["text"])
    df["tweet_text"] = ft.where(ft.notna() & (ft.astype(str).str.strip() != ""), tt)
    df["tweet_text_source"] = np.where(ft.notna() & (ft.astype(str).str.strip() != ""), "feed_tweets",
                                       np.where(tt.notna(), "tweets", "missing"))
    fh = df["tweet_id"].map(f["author_handle"])
    th = df["tweet_id"].map(t["author_handle"])
    df["author_handle"] = fh.where(fh.notna(), th)

    # --- binary materiality_engages from pipeline_scores (0/1), latest per run.
    e = eng.sort_values("created_at").drop_duplicates("run_id", keep="last").set_index("run_id")
    df["mat_engages"] = df["run_id"].map(e["score_value"])
    df["mat_engages_label"] = df["run_id"].map(e["score_label"])

    df["urls"] = df["source_url"].map(split_urls)
    df = df.sort_values("when").reset_index(drop=True)
    return meta, pulled_at, cutoff, df


if __name__ == "__main__":
    meta, pulled_at, cutoff, df = build_pairs()
    print(json.dumps(meta, indent=2))
    print(f"matured notes: {len(df)}  unique note_id: {df['note_id'].nunique()}  unique tweet_id: {df['tweet_id'].nunique()}")
    print("cn_status:", df["cn_status"].fillna("(null)").value_counts().to_dict())
    print("run join (note_id):", int(df["run_id"].notna().sum()), "of", len(df))
    print("note_text present:", int(df["note_text"].fillna("").str.strip().ne("").sum()))
    print("tweet_text source:", df["tweet_text_source"].value_counts().to_dict())
    print("tweet_text present:", int(df["tweet_text"].fillna("").str.strip().ne("").sum()))
    print("author_handle present:", int(df["author_handle"].notna().sum()))
    print("mat_engages present:", int(df["mat_engages"].notna().sum()),
          " value counts:", df["mat_engages"].value_counts(dropna=False).to_dict())
    print("urls per note:", df["urls"].map(len).value_counts().to_dict())
    print("submitted_at range:", df["when"].min(), "->", df["when"].max())
    print("\nexample note_text lengths:", df["note_text"].fillna("").str.len().describe().round(1).to_dict())
    print("example tweet_text lengths:", df["tweet_text"].fillna("").str.len().describe().round(1).to_dict())
    print("\n--- first pair (inputs only) ---")
    r = df.iloc[0]
    print("TWEET:", str(r["tweet_text"])[:400])
    print("NOTE:", str(r["note_text"])[:400])
    print("URLS:", r["urls"])
