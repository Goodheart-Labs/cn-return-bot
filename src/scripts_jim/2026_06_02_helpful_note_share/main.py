"""What share of helpful Community Notes did our bot write?

Single streaming pass over the public-data noteStatusHistory dump.

Numerator   = our notes (noteAuthorParticipantId == OUR_AUTHOR_ID) that are
              currently rated helpful.
Denominator = all notes currently rated helpful.

Also reports a "bot-era" denominator restricted to notes created on/after our
first note, since the all-time figure is diluted by years of pre-bot notes.

Run from repo root:
  uv run src/scripts_jim/2026_06_02_helpful_note_share/main.py
"""

from datetime import datetime, timezone
from pathlib import Path

# Canonical participant id of our notewriter in the public dump.
# Same constant used by src/production/fill_ratings.py.
OUR_AUTHOR_ID = "813EB394B10809EBA8D09BCFA8E2E1C25A2DA0085186867F9E9C00696951C447"

HELPFUL = "CURRENTLY_RATED_HELPFUL"

# Most recent dump on disk (downloaded ~2026-05-25).
NSH_PATH = Path(__file__).resolve().parents[2] / "production" / "cn_data" / "noteStatusHistory-00000.tsv"

# 0-based column indices (see header of noteStatusHistory-00000.tsv).
COL_AUTHOR = 1
COL_CREATED_MS = 2
COL_STATUS = 6


def fmt_ms(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date().isoformat()


def month_key(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m")


def main() -> None:
    total_notes = 0
    total_helpful = 0
    our_notes = 0
    our_helpful = 0
    our_first_created_ms = None

    # Per creation-month tallies: month -> [helpful_total, helpful_ours].
    by_month: dict[str, list[int]] = {}

    with NSH_PATH.open() as f:
        f.readline()  # skip header
        for line in f:
            cols = line.rstrip("\n").split("\t")
            is_ours = cols[COL_AUTHOR] == OUR_AUTHOR_ID
            is_helpful = cols[COL_STATUS] == HELPFUL
            created_ms = int(cols[COL_CREATED_MS])

            total_notes += 1
            if is_helpful:
                total_helpful += 1
                bucket = by_month.setdefault(month_key(created_ms), [0, 0])
                bucket[0] += 1
                if is_ours:
                    bucket[1] += 1
            if is_ours:
                our_notes += 1
                our_helpful += is_helpful
                if our_first_created_ms is None or created_ms < our_first_created_ms:
                    our_first_created_ms = created_ms

    botera_helpful = sum(h for m, (h, _) in by_month.items() if m >= month_key(our_first_created_ms))

    dump_date = datetime.fromtimestamp(NSH_PATH.stat().st_mtime, tz=timezone.utc).date().isoformat()

    print(f"Dump: {NSH_PATH.name}  (downloaded {dump_date})")
    print(f"Our author id: {OUR_AUTHOR_ID[:16]}...\n")

    print(f"Total notes in dump:            {total_notes:>12,}")
    print(f"Total currently-helpful notes:  {total_helpful:>12,}")
    print(f"  our notes:                    {our_notes:>12,}")
    print(f"  our currently-helpful notes:  {our_helpful:>12,}")
    print(f"  our helpful rate:             {our_helpful / our_notes:>12.1%}")
    print(f"\nOur first note created: {fmt_ms(our_first_created_ms)}\n")

    print("=== SHARE OF HELPFUL NOTES WRITTEN BY US ===")
    print(f"All-time:  {our_helpful:,} / {total_helpful:,} = {our_helpful / total_helpful:.4%}")
    print(f"Bot-era:   {our_helpful:,} / {botera_helpful:,} = {our_helpful / botera_helpful:.4%}   (since {fmt_ms(our_first_created_ms)})")

    print("\n=== BY NOTE CREATION MONTH (helpful notes only) ===")
    print(f"{'month':<9}{'ours':>7}{'all':>9}{'share':>9}")
    for m in sorted(by_month):
        if m < month_key(our_first_created_ms):
            continue
        helpful_all, helpful_ours = by_month[m]
        print(f"{m:<9}{helpful_ours:>7}{helpful_all:>9}{helpful_ours / helpful_all:>9.2%}")


if __name__ == "__main__":
    main()
