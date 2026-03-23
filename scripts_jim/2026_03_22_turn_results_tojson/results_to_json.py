#!/usr/bin/env python3
"""Convert the latest tryout-results CSV into pretty JSON files split by correctness."""

import csv
import json
import sys
from pathlib import Path

CORRECTION_STATUS = "CORRECTION WITH TRUSTWORTHY CITATION"
DROP_COLUMNS = {"search_results", "citations"}
RESULTS_DIR = Path(__file__).resolve().parents[2] / "tryout-results"
OUTPUT_DIR = Path(__file__).parent


def find_latest_csv() -> Path:
    csvs = sorted(RESULTS_DIR.glob("videos-*.csv"))
    if not csvs:
        sys.exit("No CSV files found in tryout-results/")
    return csvs[-1]


def is_correct(row: dict) -> bool | None:
    truth = row.get("needs_note", "").strip().lower()
    if truth not in ("yes", "no"):
        return None
    predicted_note = row.get("note_status", "") == CORRECTION_STATUS
    return (truth == "yes") == predicted_note


def parse_row(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if k in DROP_COLUMNS:
            continue
        if k == "logs" and v:
            try:
                out[k] = json.loads(v)
            except json.JSONDecodeError:
                out[k] = v
        else:
            out[k] = v
    return out


def main():
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else find_latest_csv()
    print(f"Reading {csv_path}")

    with open(csv_path) as f:
        rows = list(csv.DictReader(f))

    correct = []
    incorrect = []

    for row in rows:
        parsed = parse_row(row)
        result = is_correct(row)
        if result is True:
            correct.append(parsed)
        elif result is False:
            incorrect.append(parsed)

    for name, data in [("correct", correct), ("incorrect", incorrect)]:
        out_path = OUTPUT_DIR / f"{name}.json"
        with open(out_path, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"{name}: {len(data)} rows -> {out_path}")


if __name__ == "__main__":
    main()
