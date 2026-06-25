"""Build pairs of (our note that was NOT rated helpful, a DIFFERENT note that WAS
rated helpful on the same tweet).

Source of "the other helpful note": competing_notes (every other note on tweets
where we ran the pipeline). We keep one helpful competitor per tweet — the
earliest-created one (closest to the canonical note shown on the post).

Output: pairs.json — one row per our not-helpful note that has a helpful
alternative, with both note texts and the tweet text for context. This feeds
02_classify.py (Sonnet rates why the other note won).

Run: uv run src/scripts_jim/2026_06_15_simple_note_pairs/01_build_pairs.py
"""

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[2]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

HELPFUL = "CURRENTLY_RATED_HELPFUL"
PAGE = 1000
BATCH = 200


def fetch_all_keyset(table, cols, key, extra=None):
    out, last = [], None
    while True:
        q = sb.table(table).select(cols).order(key).limit(PAGE)
        if last is not None:
            q = q.gt(key, last)
        if extra:
            q = extra(q)
        rows = q.execute().data
        if not rows:
            break
        out.extend(rows)
        last = rows[-1][key]
        if len(rows) < PAGE:
            break
    return out


def main():
    print("Fetching our submitted not-helpful notes (with text) ...")
    ours = fetch_all_keyset(
        "notes",
        "note_id, tweet_id, note_text, cn_status",
        "note_id",
        extra=lambda q: q.neq("cn_status", HELPFUL)
        .not_.is_("submitted_at", "null")
        .not_.is_("note_text", "null"),
    )
    ours = [n for n in ours if (n["note_text"] or "").strip()]
    print(f"  -> {len(ours)} not-helpful notes")

    tweet_ids = sorted({n["tweet_id"] for n in ours})
    print(f"Fetching helpful competing notes on {len(tweet_ids)} tweets ...")
    helpful_by_tweet = {}
    for i in range(0, len(tweet_ids), BATCH):
        rows = (
            sb.table("competing_notes")
            .select("tweet_id, note_id, note_text, created_at_millis")
            .in_("tweet_id", tweet_ids[i : i + BATCH])
            .eq("current_status", HELPFUL)
            .not_.is_("note_text", "null")
            .execute()
            .data
        )
        for r in rows:
            if not (r["note_text"] or "").strip():
                continue
            helpful_by_tweet.setdefault(r["tweet_id"], []).append(r)
    print(f"  -> {len(helpful_by_tweet)} tweets have a helpful competitor")

    print("Fetching tweet texts ...")
    tweet_text = {}
    for i in range(0, len(tweet_ids), BATCH):
        rows = (
            sb.table("tweets")
            .select("tweet_id, text")
            .in_("tweet_id", tweet_ids[i : i + BATCH])
            .execute()
            .data
        )
        for t in rows:
            tweet_text[t["tweet_id"]] = t.get("text") or ""

    pairs = []
    for n in ours:
        alts = [
            h for h in helpful_by_tweet.get(n["tweet_id"], []) if h["note_id"] != n["note_id"]
        ]
        if not alts:
            continue
        # earliest helpful competitor = most canonical note on the post
        alts.sort(key=lambda h: h["created_at_millis"] or 0)
        helpful = alts[0]
        pairs.append(
            {
                "tweet_id": n["tweet_id"],
                "tweet_text": tweet_text.get(n["tweet_id"], ""),
                "our_note_id": n["note_id"],
                "our_status": n["cn_status"],
                "our_note_text": n["note_text"],
                "helpful_note_id": helpful["note_id"],
                "helpful_note_text": helpful["note_text"],
                "n_helpful_alts": len(alts),
            }
        )

    out_path = HERE / "pairs.json"
    out_path.write_text(json.dumps(pairs, indent=1))
    print(f"\nWrote {len(pairs)} pairs -> {out_path.relative_to(PROJECT_ROOT)}")
    from collections import Counter

    print("  our_status breakdown:", dict(Counter(p["our_status"] for p in pairs)))


if __name__ == "__main__":
    main()
