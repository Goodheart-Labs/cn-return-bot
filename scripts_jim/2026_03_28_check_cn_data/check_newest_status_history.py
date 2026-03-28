"""Print the latest noteStatusHistory updates from the CN public data dump."""

import csv
import os
from datetime import datetime, timezone

CN_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "cn_data")
STATUS_FILE = "noteStatusHistory-00000.tsv"
AUTHOR_ID = "813EB394B10809EBA8D09BCFA8E2E1C25A2DA0085186867F9E9C00696951C447"


def load_status_history():
    path = os.path.join(CN_DATA_DIR, STATUS_FILE)
    rows = []
    with open(path) as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            if row["noteAuthorParticipantId"] != AUTHOR_ID:
                continue
            ts = int(row["timestampMillisOfMostRecentStatusChange"] or 0)
            if ts == 0:
                continue
            rows.append(
                {
                    "noteId": row["noteId"],
                    "currentStatus": row["currentStatus"],
                    "currentDecidedBy": row["currentDecidedBy"],
                    "currentCoreStatus": row["currentCoreStatus"],
                    "lastChanged": datetime.fromtimestamp(ts / 1000, tz=timezone.utc),
                    "createdAt": datetime.fromtimestamp(
                        int(row["createdAtMillis"]) / 1000, tz=timezone.utc
                    ),
                }
            )
    return rows


def main():
    rows = load_status_history()
    print(f"Total rows for author: {len(rows):,}")

    rows.sort(key=lambda r: r["lastChanged"], reverse=True)

    print(
        f"\n{'Last Changed':<22} {'Created':<22} {'Status':<30} {'Decided By':<20} {'Core Status'}"
    )
    print("-" * 130)
    for r in rows[:30]:
        changed = r["lastChanged"].strftime("%Y-%m-%d %H:%M UTC")
        created = r["createdAt"].strftime("%Y-%m-%d %H:%M UTC")
        print(
            f"{changed:<22} {created:<22} {r['currentStatus']:<30} {r['currentDecidedBy']:<20} {r['currentCoreStatus']}"
        )

    if rows:
        oldest_change = rows[-1]["lastChanged"]
        newest_change = rows[0]["lastChanged"]
        print(f"\nStatus change date range: {oldest_change:%Y-%m-%d} to {newest_change:%Y-%m-%d}")


if __name__ == "__main__":
    main()
