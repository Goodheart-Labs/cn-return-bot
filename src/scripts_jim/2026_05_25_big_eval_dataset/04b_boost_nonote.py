"""
No-note booster: the first selection under-sourced genuine 'no note needed' tweets
(the no_note bucket leaned on NMR notes with weak note-not-needed signal, ~60% of
which actually DO need a note). This appends high-signal no-note candidates to
selected.jsonl so the final set can reach ~50% no-note.

Strong signal sources (excluding tweets already selected), deduped:
  - NOT_HELPFUL notes whose DOMINANT not-helpful reason is notHelpfulNoteNotNeeded
  - NMR notes with a STRONG note-not-needed count (>= STRONG_NNN)

  uv run src/scripts_jim/2026_05_25_big_eval_dataset/04b_boost_nonote.py [--target 250]
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BIG_EVAL = HERE.parent.parent.parent / "datasets" / "big_eval"
LABELED = BIG_EVAL / "corpus_labeled.jsonl"
SELECTED = BIG_EVAL / "selected.jsonl"

NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL"
NMR = "NEEDS_MORE_RATINGS"
NNN = "notHelpfulNoteNotNeeded"
STRONG_NNN = 5          # NMR needs a strong (not noise) note-not-needed signal
DEDUP_CAP = 2
CARRY = ["note_text", "current_status", "role", "needs_note", "categories",
         "not_helpful_tag_counts", "dominant_not_helpful_reason", "rating_volume",
         "impressions", "source"]


def sig(text: str) -> frozenset:
    words = sorted({w.lower() for w in re.findall(r"[A-Za-z]{5,}", text)}, key=len, reverse=True)[:5]
    return frozenset(words)


def main():
    target = int(sys.argv[sys.argv.index("--target") + 1]) if "--target" in sys.argv else 250
    selected = [json.loads(l) for l in SELECTED.open()]
    have = {str(r["tweet_id"]) for r in selected}
    sigs = {}
    for r in selected:
        sigs[sig(r.get("note_text", ""))] = sigs.get(sig(r.get("note_text", "")), 0) + 1

    rows = [json.loads(l) for l in LABELED.open()]
    dom = [r for r in rows if r.get("current_status") == NOT_HELPFUL
           and r.get("dominant_not_helpful_reason") == NNN]
    nmr = [r for r in rows if r.get("current_status") == NMR
           and (r.get("not_helpful_tag_counts") or {}).get(NNN, 0) >= STRONG_NNN]
    # dominant-NOT_HELPFUL first (strongest), then strong-NMR by note-not-needed count
    nmr.sort(key=lambda r: -(r.get("not_helpful_tag_counts") or {}).get(NNN, 0))
    pool = dom + nmr

    added = []
    for r in pool:
        if len(added) >= target:
            break
        tid = str(r["tweet_id"])
        if tid in have:
            continue
        s = sig(r.get("note_text", ""))
        if sigs.get(s, 0) >= DEDUP_CAP:
            continue
        have.add(tid); sigs[s] = sigs.get(s, 0) + 1
        entry = {"note_id": r.get("note_id"), "tweet_id": tid, "url": f"https://x.com/i/status/{tid}",
                 "selection_bucket": "no_note_booster", "showcase_hint": None}
        for k in CARRY:
            if k in r:
                entry[k] = r[k]
        added.append(entry)

    print(f"dominant-NOT_HELPFUL pool: {len(dom)}, strong-NMR pool: {len(nmr)}")
    with SELECTED.open("a") as f:
        for e in added:
            f.write(json.dumps(e) + "\n")
    print(f"appended {len(added)} no-note-booster rows -> selected.jsonl (now {len(selected)+len(added)} total)")


if __name__ == "__main__":
    main()
