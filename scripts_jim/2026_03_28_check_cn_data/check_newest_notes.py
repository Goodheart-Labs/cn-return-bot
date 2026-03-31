"""Print the newest notes from the CN public data dump."""

import csv
import os
from datetime import datetime, timezone

CN_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "cn_data")
NOTE_FILES = ["notes-00000.tsv", "notes-00001.tsv"]
AUTHOR_ID = "813EB394B10809EBA8D09BCFA8E2E1C25A2DA0085186867F9E9C00696951C447"


def load_notes():
    notes = []
    for fname in NOTE_FILES:
        path = os.path.join(CN_DATA_DIR, fname)
        if not os.path.exists(path):
            print(f"Missing {fname}, skipping")
            continue
        with open(path) as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                if row["noteAuthorParticipantId"] != AUTHOR_ID:
                    continue
                ts = int(row["createdAtMillis"])
                notes.append(
                    {
                        "noteId": row["noteId"],
                        "tweetId": row["tweetId"],
                        "classification": row["classification"],
                        "summary": row["summary"][:120],
                        "createdAt": datetime.fromtimestamp(ts / 1000, tz=timezone.utc),
                    }
                )
    return notes


def main():
    notes = load_notes()
    print(f"Total notes: {len(notes):,}")

    notes.sort(key=lambda n: n["createdAt"], reverse=True)

    print(f"\n{'Date':<22} {'Classification':<45} {'Summary'}")
    print("-" * 140)
    for n in notes[:30]:
        date_str = n["createdAt"].strftime("%Y-%m-%d %H:%M UTC")
        print(f"{date_str:<22} {n['classification']:<45} {n['summary']}")

    # Date range
    oldest = notes[-1]["createdAt"]
    newest = notes[0]["createdAt"]
    print(f"\nDate range: {oldest:%Y-%m-%d} to {newest:%Y-%m-%d}")


if __name__ == "__main__":
    main()
