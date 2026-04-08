"""
For tweets with both helpful and NMR notes, how often was the helpful note written first?
Compares our notes vs competing notes on the same tweet using created_at_millis.
"""
import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


def fetch_all(table, select, filters=None):
    rows, offset, page = [], 0, 1000
    while True:
        q = sb.table(table).select(select)
        if filters:
            for col, op, val in filters:
                q = q.filter(col, op, val)
        resp = q.range(offset, offset + page - 1).execute()
        rows.extend(resp.data)
        if len(resp.data) < page:
            break
        offset += page
    return rows


# Get our notes' created_at_millis from public_data_snapshots
print("Fetching our notes from public_data_snapshots...")
our_snapshots = fetch_all(
    "public_data_snapshots",
    "note_id, tweet_id, current_status, created_at_millis, snapshot_date",
    [("is_ours", "eq", True)],
)

# Dedupe: keep latest snapshot per note_id
our_notes_map = {}
for s in our_snapshots:
    nid = s["note_id"]
    if nid not in our_notes_map or s["snapshot_date"] > our_notes_map[nid]["snapshot_date"]:
        our_notes_map[nid] = s

print(f"Our notes with public data: {len(our_notes_map)}")

# Get competing notes
print("Fetching competing_notes...")
competing = fetch_all(
    "competing_notes",
    "tweet_id, note_id, our_note_id, current_status, created_at_millis",
)
print(f"Competing notes: {len(competing)}")

# Build per-tweet note list: all notes (ours + competing) with status and timestamp
# Group by tweet_id
tweet_notes = defaultdict(list)

for nid, n in our_notes_map.items():
    if n["created_at_millis"]:
        tweet_notes[n["tweet_id"]].append({
            "note_id": nid,
            "status": n["current_status"],
            "created_at_millis": n["created_at_millis"],
            "is_ours": True,
        })

for c in competing:
    if c["created_at_millis"]:
        tweet_notes[c["tweet_id"]].append({
            "note_id": c["note_id"],
            "status": c["current_status"],
            "created_at_millis": c["created_at_millis"],
            "is_ours": False,
        })


def is_helpful(status):
    return status and "HELPFUL" in status and "NOT" not in status


def is_nmr(status):
    return status and "NEEDS_MORE_RATINGS" in status


def analyze(tweet_notes_dict, label="ALL TIME"):
    helpful_earlier = 0
    nmr_earlier = 0
    same_time = 0
    total_pairs = 0
    tweets_with_both = 0

    for tweet_id, notes in tweet_notes_dict.items():
        helpfuls = [n for n in notes if is_helpful(n["status"])]
        nmrs = [n for n in notes if is_nmr(n["status"])]

        if not helpfuls or not nmrs:
            continue

        tweets_with_both += 1

        for h in helpfuls:
            for n in nmrs:
                total_pairs += 1
                if h["created_at_millis"] < n["created_at_millis"]:
                    helpful_earlier += 1
                elif h["created_at_millis"] > n["created_at_millis"]:
                    nmr_earlier += 1
                else:
                    same_time += 1

    print(f"\n=== {label} ===")
    print(f"Tweets with both helpful + NMR notes: {tweets_with_both}")
    print(f"Total (helpful, NMR) pairs: {total_pairs}")
    if total_pairs:
        print(f"Helpful written EARLIER: {helpful_earlier} ({helpful_earlier/total_pairs:.1%})")
        print(f"NMR written EARLIER:     {nmr_earlier} ({nmr_earlier/total_pairs:.1%})")
        print(f"Same time:               {same_time} ({same_time/total_pairs:.1%})")

    # Break down by whether our note is the helpful or NMR one
    our_helpful_earlier = 0
    our_helpful_later = 0
    our_nmr_earlier = 0
    our_nmr_later = 0
    our_pairs = 0

    for tweet_id, notes in tweet_notes_dict.items():
        helpfuls = [n for n in notes if is_helpful(n["status"])]
        nmrs = [n for n in notes if is_nmr(n["status"])]
        if not helpfuls or not nmrs:
            continue

        our_helpfuls = [n for n in helpfuls if n["is_ours"]]
        our_nmrs = [n for n in nmrs if n["is_ours"]]

        # Our helpful vs their NMR
        for h in our_helpfuls:
            for n in nmrs:
                if n["is_ours"]:
                    continue
                our_pairs += 1
                if h["created_at_millis"] < n["created_at_millis"]:
                    our_helpful_earlier += 1
                else:
                    our_helpful_later += 1

        # Our NMR vs their helpful
        for n in our_nmrs:
            for h in helpfuls:
                if h["is_ours"]:
                    continue
                our_pairs += 1
                if n["created_at_millis"] < h["created_at_millis"]:
                    our_nmr_earlier += 1
                else:
                    our_nmr_later += 1

    if our_pairs:
        print(f"\n  Our note is helpful, written before competing NMR: {our_helpful_earlier}")
        print(f"  Our note is helpful, written after competing NMR:  {our_helpful_later}")
        print(f"  Our note is NMR, written before competing helpful: {our_nmr_earlier}")
        print(f"  Our note is NMR, written after competing helpful:  {our_nmr_later}")

    # P(helpful|first) and P(helpful|not first) for our notes
    # For each tweet, check if our note was the earliest among all notes on that tweet
    our_first_helpful = 0
    our_first_nmr = 0
    our_first_other = 0
    our_notfirst_helpful = 0
    our_notfirst_nmr = 0
    our_notfirst_other = 0

    for tweet_id, notes in tweet_notes_dict.items():
        ours = [n for n in notes if n["is_ours"]]
        if not ours:
            continue
        earliest_millis = min(n["created_at_millis"] for n in notes)
        for n in ours:
            h = is_helpful(n["status"])
            m = is_nmr(n["status"])
            first = n["created_at_millis"] == earliest_millis
            if first:
                if h: our_first_helpful += 1
                elif m: our_first_nmr += 1
                else: our_first_other += 1
            else:
                if h: our_notfirst_helpful += 1
                elif m: our_notfirst_nmr += 1
                else: our_notfirst_other += 1

    first_total = our_first_helpful + our_first_nmr + our_first_other
    notfirst_total = our_notfirst_helpful + our_notfirst_nmr + our_notfirst_other
    print(f"\n  Given our note is FIRST on the tweet (n={first_total}):")
    if first_total:
        print(f"    P(helpful) = {our_first_helpful}/{first_total} = {our_first_helpful/first_total:.1%}")
        print(f"    P(nmr)     = {our_first_nmr}/{first_total} = {our_first_nmr/first_total:.1%}")
        print(f"    P(other)   = {our_first_other}/{first_total} = {our_first_other/first_total:.1%}")
    print(f"  Given our note is NOT first (n={notfirst_total}):")
    if notfirst_total:
        print(f"    P(helpful) = {our_notfirst_helpful}/{notfirst_total} = {our_notfirst_helpful/notfirst_total:.1%}")
        print(f"    P(nmr)     = {our_notfirst_nmr}/{notfirst_total} = {our_notfirst_nmr/notfirst_total:.1%}")
        print(f"    P(other)   = {our_notfirst_other}/{notfirst_total} = {our_notfirst_other/notfirst_total:.1%}")


# All time
analyze(tweet_notes, "ALL TIME")

# March 2026 only: filter by created_at_millis
from datetime import datetime, timezone

MARCH_START = int(datetime(2026, 3, 1, tzinfo=timezone.utc).timestamp() * 1000)
MARCH_END = int(datetime(2026, 4, 1, tzinfo=timezone.utc).timestamp() * 1000)

print(f"\nMarch range: {MARCH_START} - {MARCH_END}")

# For March: include tweets where ANY note was created in March
march_notes = {}
for tid, notes in tweet_notes.items():
    has_march = any(MARCH_START <= n["created_at_millis"] < MARCH_END for n in notes)
    if has_march:
        march_notes[tid] = notes

analyze(march_notes, "MARCH 2026 (tweets with any note in March)")

# Dump March pairs for similarity analysis
print("\n--- Dumping March helpful/NMR pairs ---")

# Need note texts: fetch from canonical_note_information and competing_notes
print("Fetching note texts...")
our_texts_raw = fetch_all("canonical_note_information", "note_id, note_text, tweet_id, tweet_text")
our_text_map = {r["note_id"]: r for r in our_texts_raw}

competing_text_map = {r["note_id"]: r for r in competing}
# competing already has note_text? Let me check
# competing_notes select doesn't include note_text, re-fetch
competing_full = fetch_all("competing_notes", "note_id, our_note_id, tweet_id, note_text, current_status, created_at_millis")
comp_text_map = {}
for c in competing_full:
    comp_text_map[c["note_id"]] = c

import json

pairs = []
for tid, notes in march_notes.items():
    helpfuls = [n for n in notes if is_helpful(n["status"])]
    nmrs = [n for n in notes if is_nmr(n["status"])]
    if not helpfuls or not nmrs:
        continue

    # Get tweet text from our note
    tweet_text = ""
    for n in notes:
        if n["is_ours"] and n["note_id"] in our_text_map:
            tweet_text = our_text_map[n["note_id"]].get("tweet_text", "") or ""
            break

    for h in helpfuls:
        h_text = ""
        if h["is_ours"] and h["note_id"] in our_text_map:
            h_text = our_text_map[h["note_id"]].get("note_text", "") or ""
        elif h["note_id"] in comp_text_map:
            h_text = comp_text_map[h["note_id"]].get("note_text", "") or ""

        for n in nmrs:
            n_text = ""
            if n["is_ours"] and n["note_id"] in our_text_map:
                n_text = our_text_map[n["note_id"]].get("note_text", "") or ""
            elif n["note_id"] in comp_text_map:
                n_text = comp_text_map[n["note_id"]].get("note_text", "") or ""

            pairs.append({
                "tweet_id": tid,
                "tweet_text": tweet_text[:300],
                "helpful_note_id": h["note_id"],
                "helpful_is_ours": h["is_ours"],
                "helpful_created_ms": h["created_at_millis"],
                "helpful_text": h_text,
                "nmr_note_id": n["note_id"],
                "nmr_is_ours": n["is_ours"],
                "nmr_created_ms": n["created_at_millis"],
                "nmr_text": n_text,
                "helpful_first": h["created_at_millis"] < n["created_at_millis"],
            })

out_path = Path(__file__).parent / "march_pairs.json"
with open(out_path, "w") as f:
    json.dump(pairs, f, indent=2)
print(f"Wrote {len(pairs)} pairs to {out_path}")
