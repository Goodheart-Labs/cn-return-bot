"""
Relationship between eval score and probability of helpful/unhelpful outcome.
Excludes 25 Feb – 15 Mar (known bad period).
Also shows separate analysis for 16 Mar – now.
"""
import os
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

# Fetch submitted notes with eval score
print("Fetching notes...")
all_notes = []
offset = 0
while True:
    resp = sb.table("notes").select(
        "note_id, evaluation_score, submitted_at, cn_status, "
        "helpful_count, not_helpful_count"
    ).not_.is_("evaluation_score", "null").range(offset, offset + 999).execute()
    all_notes.extend(resp.data)
    if len(resp.data) < 1000:
        break
    offset += 1000
print(f"Notes with eval score: {len(all_notes)}")

# Fetch canonical status for better outcome data
print("Fetching canonical_note_information...")
canonical = {}
offset = 0
while True:
    resp = sb.table("canonical_note_information").select(
        "note_id, cn_status, most_recent_non_nmr_status, locked_status, "
        "first_non_nmr_status, classification"
    ).range(offset, offset + 999).execute()
    for r in resp.data:
        canonical[r["note_id"]] = r
    if len(resp.data) < 1000:
        break
    offset += 1000
print(f"Canonical records: {len(canonical)}")


def classify_outcome(note):
    c = canonical.get(note["note_id"], {})
    if not c:
        # Not in canonical — treat as unresolved
        cn = (note.get("cn_status") or "").lower()
        if "helpful" in cn and "not" not in cn:
            return "helpful"
        if "not_helpful" in cn or "unhelpful" in cn:
            return "unhelpful"
        return "nmr"
    status = (
        c.get("locked_status")
        or c.get("most_recent_non_nmr_status")
        or c.get("first_non_nmr_status")
        or c.get("classification")
        or c.get("cn_status")
        or ""
    )
    s = status.lower()
    if "currently_rated_helpful" in s:
        return "helpful"
    if "currently_rated_not_helpful" in s:
        return "unhelpful"
    if "helpful" in s and "not" not in s:
        return "helpful"
    if "not_helpful" in s or "unhelpful" in s:
        return "unhelpful"
    return "nmr"


EXCLUDE_START = datetime(2025, 2, 25)
EXCLUDE_END = datetime(2025, 3, 15)
# Actually use 2026
EXCLUDE_START = datetime(2026, 2, 25)
EXCLUDE_END = datetime(2026, 3, 15)
RECENT_START = datetime(2026, 3, 16)

BINS = [
    (0.0, 0.5),
    (0.5, 0.6),
    (0.6, 0.7),
    (0.7, 0.8),
    (0.8, 0.9),
    (0.9, 1.0),
    (1.0, 1.01),  # exact 1.0
]
BIN_LABELS = ["<0.5", "0.5-0.6", "0.6-0.7", "0.7-0.8", "0.8-0.9", "0.9-1.0", "1.0"]


def bin_index(score):
    for i, (lo, hi) in enumerate(BINS):
        if lo <= score < hi:
            return i
    if score >= 1.0:
        return len(BINS) - 1
    return 0


def analyze(notes, label):
    bins = defaultdict(lambda: {"helpful": 0, "unhelpful": 0, "nmr": 0, "other": 0, "total": 0})
    for n in notes:
        score = n["evaluation_score"]
        if score is None:
            continue
        outcome = classify_outcome(n)
        idx = bin_index(score)
        bins[idx][outcome] += 1
        bins[idx]["total"] += 1

    print(f"\n{'=' * 80}")
    print(f"  {label}")
    print(f"  n = {len(notes)}")
    print(f"{'=' * 80}")
    print(f"{'Eval Score':>12} {'Total':>6} {'Helpful':>8} {'Unhelpful':>10} {'NMR':>6} {'H%':>7} {'UH%':>7} {'H/(H+UH)':>10}")
    print("-" * 75)

    totals = {"helpful": 0, "unhelpful": 0, "nmr": 0, "other": 0, "total": 0}
    for i, lbl in enumerate(BIN_LABELS):
        d = bins[i]
        t = d["total"]
        h, uh, nmr = d["helpful"], d["unhelpful"], d["nmr"]
        h_pct = f"{h/t*100:.1f}%" if t else "-"
        uh_pct = f"{uh/t*100:.1f}%" if t else "-"
        resolved = h + uh
        h_of_resolved = f"{h/resolved*100:.1f}%" if resolved else "-"
        print(f"{lbl:>12} {t:>6} {h:>8} {uh:>10} {nmr:>6} {h_pct:>7} {uh_pct:>7} {h_of_resolved:>10}")
        for k in totals:
            totals[k] += d[k]

    t = totals["total"]
    h, uh = totals["helpful"], totals["unhelpful"]
    resolved = h + uh
    print("-" * 75)
    print(f"{'TOTAL':>12} {t:>6} {h:>8} {uh:>10} {totals['nmr']:>6} "
          f"{h/t*100:.1f}%  {uh/t*100:.1f}%  {h/resolved*100:.1f}%" if resolved else "")

    # Also show mean eval score per outcome
    by_outcome = defaultdict(list)
    for n in notes:
        if n["evaluation_score"] is not None:
            by_outcome[classify_outcome(n)].append(n["evaluation_score"])

    print(f"\nMean eval score by outcome:")
    for outcome in ["helpful", "unhelpful", "nmr"]:
        scores = by_outcome[outcome]
        if scores:
            print(f"  {outcome:>12}: {sum(scores)/len(scores):.3f}  (n={len(scores)})")


# Filter notes
alltime_excl = []
recent = []

for n in all_notes:
    dt_str = n.get("submitted_at")
    if not dt_str:
        continue
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
    if EXCLUDE_START <= dt <= EXCLUDE_END:
        continue
    alltime_excl.append(n)
    if dt >= RECENT_START:
        recent.append(n)

analyze(alltime_excl, "ALL TIME (excl. 25 Feb – 15 Mar)")
analyze(recent, "RECENT: 16 Mar – now")
