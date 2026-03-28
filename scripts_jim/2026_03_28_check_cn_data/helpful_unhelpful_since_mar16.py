"""Print all helpful and unhelpful notes from the author created 2026-03-16 or later."""

import csv
import os
from datetime import datetime, timezone

CN_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "cn_data")
STATUS_FILE = "noteStatusHistory-00000.tsv"
NOTE_FILES = ["notes-00000.tsv", "notes-00001.tsv"]
AUTHOR_ID = "813EB394B10809EBA8D09BCFA8E2E1C25A2DA0085186867F9E9C00696951C447"
CUTOFF = datetime(2026, 3, 16, tzinfo=timezone.utc)
RATED_STATUSES = {"CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL"}


def load_statuses():
    path = os.path.join(CN_DATA_DIR, STATUS_FILE)
    rows = []
    with open(path) as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            if row["noteAuthorParticipantId"] != AUTHOR_ID:
                continue
            if row["currentStatus"] not in RATED_STATUSES:
                continue
            created = datetime.fromtimestamp(
                int(row["createdAtMillis"]) / 1000, tz=timezone.utc
            )
            if created < CUTOFF:
                continue
            rows.append(
                {
                    "noteId": row["noteId"],
                    "status": row["currentStatus"],
                    "decidedBy": row["currentDecidedBy"],
                    "coreStatus": row["currentCoreStatus"],
                    "createdAt": created,
                }
            )
    return rows


def load_summaries():
    summaries = {}
    for fname in NOTE_FILES:
        path = os.path.join(CN_DATA_DIR, fname)
        if not os.path.exists(path):
            continue
        with open(path) as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                if row["noteAuthorParticipantId"] == AUTHOR_ID:
                    summaries[row["noteId"]] = row["summary"][:120]
    return summaries


def main():
    rows = load_statuses()
    summaries = load_summaries()
    rows.sort(key=lambda r: r["createdAt"], reverse=True)

    helpful = [r for r in rows if r["status"] == "CURRENTLY_RATED_HELPFUL"]
    unhelpful = [r for r in rows if r["status"] == "CURRENTLY_RATED_NOT_HELPFUL"]
    print(f"Since {CUTOFF:%Y-%m-%d}: {len(helpful)} helpful, {len(unhelpful)} unhelpful\n")

    for label, group in [("HELPFUL", helpful), ("NOT HELPFUL", unhelpful)]:
        print(f"=== {label} ({len(group)}) ===")
        print(f"{'Created':<22} {'Decided By':<20} {'Summary'}")
        print("-" * 120)
        for r in group:
            created = r["createdAt"].strftime("%Y-%m-%d %H:%M UTC")
            summary = summaries.get(r["noteId"], "")
            print(f"{created:<22} {r['decidedBy']:<20} {summary}")
        print()


if __name__ == "__main__":
    main()
