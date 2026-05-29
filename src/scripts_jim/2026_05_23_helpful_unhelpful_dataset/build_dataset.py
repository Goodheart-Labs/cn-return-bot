"""
Build an eval dataset of:
  - The latest 40 unhelpful notes we submitted.
  - 40 helpful notes sampled from the union of (our helpful submissions) and
    (helpful competing notes by anyone), within the same submission window.
    competing_notes is already scoped to tweets where we ran the pipeline, so
    both halves cover "tweets we processed".

Columns match datasets/video_testset.csv:
    url, needs_note, ground_truth_note, tweet_text, tags

needs_note rules:
  - helpful row                                       -> yes
  - unhelpful row, helpful competing note exists      -> yes (ground_truth = that helpful note)
  - unhelpful row, no helpful competing note          -> no  (ground_truth = our bad note)

Outputs in datasets/:
    helpful_unhelpful_allset.csv             (80)
    helpful_unhelpful_testset.csv            (40, even-indexed split)
    helpful_unhelpful_testset_small.csv      (20)
    helpful_unhelpful_testset_very_small.csv (10)
    helpful_unhelpful_valset.csv             (40, odd-indexed split)
    helpful_unhelpful_valset_small.csv       (20)
    helpful_unhelpful_valset_very_small.csv  (10)
"""
import os
import csv
import random
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent.parent.parent
DATASETS_DIR = PROJECT_ROOT / "datasets"

load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

HELPFUL = "CURRENTLY_RATED_HELPFUL"
UNHELPFUL = "CURRENTLY_RATED_NOT_HELPFUL"

TARGET_PER_CLASS = 40
SPLIT_PER_CLASS = 20
SMALL_PER_CLASS = 10
VERY_SMALL_PER_CLASS = 5
PAGE = 1000
BATCH = 200
RANDOM_SEED = 42


def fetch_latest_unhelpful(limit: int):
    return (
        sb.table("notes")
        .select("note_id, tweet_id, note_text, submitted_at, cn_status")
        .eq("cn_status", UNHELPFUL)
        .not_.is_("submitted_at", "null")
        .not_.is_("note_text", "null")
        .order("submitted_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )


def fetch_competing_helpful_for_tweets(tweet_ids):
    """Returns {tweet_id: first_competing_helpful_row}."""
    out = {}
    for i in range(0, len(tweet_ids), BATCH):
        chunk = tweet_ids[i : i + BATCH]
        rows = (
            sb.table("competing_notes")
            .select("tweet_id, note_id, note_text, current_status, created_at_millis")
            .in_("tweet_id", chunk)
            .eq("current_status", HELPFUL)
            .not_.is_("note_text", "null")
            .execute()
            .data
        )
        for r in rows:
            tid = r["tweet_id"]
            if tid not in out:
                out[tid] = r
    return out


def fetch_our_helpful_in_window(since_iso, until_iso):
    out, last = [], None
    while True:
        q = (
            sb.table("notes")
            .select("note_id, tweet_id, note_text, submitted_at")
            .eq("cn_status", HELPFUL)
            .not_.is_("submitted_at", "null")
            .not_.is_("note_text", "null")
            .gte("submitted_at", since_iso)
            .lte("submitted_at", until_iso)
            .order("note_id")
            .limit(PAGE)
        )
        if last is not None:
            q = q.gt("note_id", last)
        rows = q.execute().data
        if not rows:
            break
        out.extend(rows)
        last = rows[-1]["note_id"]
        if len(rows) < PAGE:
            break
    return out


def fetch_competing_helpful_in_window(since_ms, until_ms):
    out, last = [], None
    while True:
        q = (
            sb.table("competing_notes")
            .select("note_id, tweet_id, note_text, created_at_millis")
            .eq("current_status", HELPFUL)
            .not_.is_("note_text", "null")
            .gte("created_at_millis", since_ms)
            .lte("created_at_millis", until_ms)
            .order("note_id")
            .limit(PAGE)
        )
        if last is not None:
            q = q.gt("note_id", last)
        rows = q.execute().data
        if not rows:
            break
        out.extend(rows)
        last = rows[-1]["note_id"]
        if len(rows) < PAGE:
            break
    return out


def fetch_tweet_texts(tweet_ids):
    out = {}
    for i in range(0, len(tweet_ids), BATCH):
        chunk = tweet_ids[i : i + BATCH]
        rows = (
            sb.table("tweets")
            .select("tweet_id, text")
            .in_("tweet_id", chunk)
            .execute()
            .data
        )
        for t in rows:
            out[t["tweet_id"]] = t.get("text") or ""
    return out


def iso_to_ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


def write_csv(path: Path, rows):
    fieldnames = ["url", "needs_note", "ground_truth_note", "tweet_text", "tags"]
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {len(rows)} rows -> {path.relative_to(PROJECT_ROOT)}")


def make_row(*, tweet_id, needs_note, ground_truth_note, tweet_text, tag):
    return {
        "url": f"https://x.com/i/status/{tweet_id}",
        "needs_note": needs_note,
        "ground_truth_note": ground_truth_note or "",
        "tweet_text": tweet_text,
        "tags": tag,
    }


def main():
    print(f"Fetching latest {TARGET_PER_CLASS} unhelpful notes ...")
    unhelpful = fetch_latest_unhelpful(TARGET_PER_CLASS)
    print(f"  -> {len(unhelpful)} rows")
    assert len(unhelpful) == TARGET_PER_CLASS

    since_iso = min(n["submitted_at"] for n in unhelpful)
    until_iso = max(n["submitted_at"] for n in unhelpful)
    print(f"Time window: {since_iso}  ..  {until_iso}")

    unhelpful_tweet_ids = sorted({n["tweet_id"] for n in unhelpful})
    print(f"\nChecking competing helpful notes on {len(unhelpful_tweet_ids)} unhelpful tweets ...")
    alts = fetch_competing_helpful_for_tweets(unhelpful_tweet_ids)
    print(f"  -> {len(alts)} have a helpful alternative")

    print(f"\nFetching helpful notes in window ...")
    our_helpful = fetch_our_helpful_in_window(since_iso, until_iso)
    competing_helpful = fetch_competing_helpful_in_window(iso_to_ms(since_iso), iso_to_ms(until_iso))
    print(f"  -> {len(our_helpful)} ours, {len(competing_helpful)} competing")

    excluded_tweet_ids = {n["tweet_id"] for n in unhelpful}
    combined = []
    for n in our_helpful:
        combined.append({"tweet_id": n["tweet_id"], "note_text": n["note_text"], "source": "ours"})
    for n in competing_helpful:
        combined.append({"tweet_id": n["tweet_id"], "note_text": n["note_text"], "source": "competing"})

    rng = random.Random(RANDOM_SEED)
    rng.shuffle(combined)

    # One helpful note per tweet, no overlap with unhelpful side.
    seen_tweet_ids = set(excluded_tweet_ids)
    pool = []
    for n in combined:
        if n["tweet_id"] in seen_tweet_ids:
            continue
        seen_tweet_ids.add(n["tweet_id"])
        pool.append(n)
    print(f"  -> helpful candidate pool (one-per-tweet, excl. unhelpful tweets): {len(pool)}")
    assert len(pool) >= TARGET_PER_CLASS, f"only {len(pool)} helpful candidates"

    helpful_sample = pool[:TARGET_PER_CLASS]
    helpful_source_counts = {}
    for n in helpful_sample:
        helpful_source_counts[n["source"]] = helpful_source_counts.get(n["source"], 0) + 1
    print(f"  -> helpful sample sources: {helpful_source_counts}")

    all_tweet_ids = sorted(
        {n["tweet_id"] for n in unhelpful} | {n["tweet_id"] for n in helpful_sample}
    )
    print(f"\nFetching {len(all_tweet_ids)} tweet texts ...")
    tweet_texts = fetch_tweet_texts(all_tweet_ids)
    print(f"  -> {len(tweet_texts)} found")

    helpful_rows = [
        make_row(
            tweet_id=n["tweet_id"],
            needs_note="yes",
            ground_truth_note=n["note_text"],
            tweet_text=tweet_texts.get(n["tweet_id"], ""),
            tag=f"helpful_{n['source']}",
        )
        for n in helpful_sample
    ]

    unhelpful_rows = []
    for n in unhelpful:
        alt = alts.get(n["tweet_id"])
        if alt:
            unhelpful_rows.append(
                make_row(
                    tweet_id=n["tweet_id"],
                    needs_note="yes",
                    ground_truth_note=alt["note_text"],
                    tweet_text=tweet_texts.get(n["tweet_id"], ""),
                    tag="unhelpful_has_alt",
                )
            )
        else:
            unhelpful_rows.append(
                make_row(
                    tweet_id=n["tweet_id"],
                    needs_note="no",
                    ground_truth_note=n["note_text"],
                    tweet_text=tweet_texts.get(n["tweet_id"], ""),
                    tag="unhelpful_no_alt",
                )
            )

    # Interleaved test/val split.
    helpful_test, helpful_val = helpful_rows[0::2], helpful_rows[1::2]
    unhelpful_test, unhelpful_val = unhelpful_rows[0::2], unhelpful_rows[1::2]
    assert len(helpful_test) == len(helpful_val) == SPLIT_PER_CLASS
    assert len(unhelpful_test) == len(unhelpful_val) == SPLIT_PER_CLASS

    allset = helpful_rows + unhelpful_rows
    testset = helpful_test + unhelpful_test
    valset = helpful_val + unhelpful_val

    write_csv(DATASETS_DIR / "helpful_unhelpful_allset.csv", allset)

    write_csv(DATASETS_DIR / "helpful_unhelpful_testset.csv", testset)
    write_csv(
        DATASETS_DIR / "helpful_unhelpful_testset_small.csv",
        helpful_test[:SMALL_PER_CLASS] + unhelpful_test[:SMALL_PER_CLASS],
    )
    write_csv(
        DATASETS_DIR / "helpful_unhelpful_testset_very_small.csv",
        helpful_test[:VERY_SMALL_PER_CLASS] + unhelpful_test[:VERY_SMALL_PER_CLASS],
    )

    write_csv(DATASETS_DIR / "helpful_unhelpful_valset.csv", valset)
    write_csv(
        DATASETS_DIR / "helpful_unhelpful_valset_small.csv",
        helpful_val[:SMALL_PER_CLASS] + unhelpful_val[:SMALL_PER_CLASS],
    )
    write_csv(
        DATASETS_DIR / "helpful_unhelpful_valset_very_small.csv",
        helpful_val[:VERY_SMALL_PER_CLASS] + unhelpful_val[:VERY_SMALL_PER_CLASS],
    )


if __name__ == "__main__":
    main()
