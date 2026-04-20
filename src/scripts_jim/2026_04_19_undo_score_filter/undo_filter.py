"""Edit a dataset_runs CSV as if the scoring-filter step had not rejected notes.

For every row whose outcome starts with 'rejected (scoring_filters_failed)' and
that has a non-empty note_text, we:
  - set outcome to 'proposed'
  - set note_status to CORRECTION WITH TRUSTWORTHY CITATION
  - re-categorize the result:
      needs_note=yes → call the LLM judge (correct / incorrect)
      needs_note=no  → 'false positive'

Writes a new CSV next to the original (suffix '_no_filter.csv') and prints a
summary of before/after counts.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

CORRECTION_STATUS = "CORRECTION WITH TRUSTWORTHY CITATION"
JUDGE_MODEL = "anthropic/claude-opus-4-6"
FILTER_MARKER = "scoring_filters_failed"


def make_client() -> OpenAI:
    key = os.environ["OPENROUTER_API_KEY"]
    return OpenAI(api_key=key, base_url="https://openrouter.ai/api/v1")


def judge_note(client: OpenAI, tweet: str, ground_truth: str, note: str) -> Optional[bool]:
    prompt = (
        "Judge whether the proposed note is directionally correct, given what you know "
        'about the ground truth note. Reply JSON: {"correct": true/false}\n\n'
        f"Tweet: {tweet}\n"
        f"Ground truth: {ground_truth}\n"
        f"Proposed note: {note}"
    )
    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model=JUDGE_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=1,
            )
            content = resp.choices[0].message.content or ""
            match = re.search(r"\{[\s\S]*\}", content)
            if match:
                parsed = json.loads(match.group(0))
                return bool(parsed.get("correct", False))
        except Exception as err:
            print(f"  judge attempt {attempt+1} failed: {err}")
            time.sleep(2 * (attempt + 1))
    return None


def process_csv(csv_path: Path) -> Path:
    df = pd.read_csv(csv_path)
    client = make_client()

    before = df["result"].fillna("").value_counts().to_dict()
    changed = 0

    for idx, row in df.iterrows():
        outcome = str(row.get("outcome") or "")
        if FILTER_MARKER not in outcome:
            continue
        note_text = str(row.get("note_text") or "").strip()
        if not note_text:
            continue

        needs = str(row.get("needs_note") or "").strip().lower()
        df.at[idx, "outcome"] = "proposed"
        df.at[idx, "note_status"] = CORRECTION_STATUS

        if needs == "no":
            df.at[idx, "result"] = "false positive"
            changed += 1
            print(f"  [row {idx}] needs_note=no → false positive")
        elif needs == "yes":
            print(f"  [row {idx}] needs_note=yes → judging note...")
            verdict = judge_note(
                client,
                tweet=str(row.get("text") or ""),
                ground_truth=str(row.get("ground_truth_note") or ""),
                note=note_text,
            )
            if verdict is True:
                df.at[idx, "result"] = "correct"
            elif verdict is False:
                df.at[idx, "result"] = "incorrect"
            else:
                df.at[idx, "result"] = "error"
            print(f"    → {df.at[idx, 'result']}")
            changed += 1

    after = df["result"].fillna("").value_counts().to_dict()

    out_path = csv_path.with_name(csv_path.stem + "_no_filter.csv")
    df.to_csv(out_path, index=False)
    print(f"\nrows changed: {changed}")
    print(f"result counts before: {before}")
    print(f"result counts after:  {after}")
    print(f"wrote {out_path}")
    return out_path


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: undo_filter.py <results.csv> [more.csv ...]")
        sys.exit(1)
    for arg in sys.argv[1:]:
        p = Path(arg)
        if not p.exists():
            print(f"missing: {p}")
            continue
        print(f"=== {p} ===")
        process_csv(p)
        print()


if __name__ == "__main__":
    main()
