"""
Trim the bulky per-row JSONs from a run folder into compact failure summaries
that subagents can read cheaply. Each summary keeps only the fields needed for
pattern diagnosis (tweet, original note, judge_guidance, bot's queries +
proposed note + stage-by-stage abstention reasons). Drops the full pipeline log.

Writes one JSON file per batch under <run>/_failure_batches/.

  uv run .../09_prep_failure_batches.py <run_folder>
"""
import json
import sys
from pathlib import Path

CATEGORIES = [
    ("non_note_worthy_incorrect", "FP — bot proposed a note on a needs_note=no tweet"),
    ("note_worthy_incorrect",     "incorrect — bot proposed a note that the judge rejected"),
    ("note_worthy_not_proposed",  "missed — bot abstained on a needs_note=yes tweet"),
]


def trim_row(r: dict, category: str) -> dict:
    logs = r.get("logs") or {}
    if isinstance(logs, str):
        try:
            logs = json.loads(logs)
        except Exception:
            logs = {}
    cb = logs.get("cheapBot", {}) if isinstance(logs, dict) else {}
    sb = logs.get("simpleBot", {}) if isinstance(logs, dict) else {}

    writer = sb.get("writer", {})
    writer_response = None
    attempts = writer.get("attempts", {}) if isinstance(writer, dict) else {}
    if attempts:
        first = sorted(attempts.keys())[0]
        writer_response = attempts.get(first, {}).get("response")

    judge = sb.get("judge", {})
    judge_content = None
    if isinstance(judge, dict):
        msgs = judge.get("messages", {})
        if isinstance(msgs, dict):
            judge_content = msgs.get("1", {}).get("content")

    return {
        "category": category,
        "url": r.get("url"),
        "tweet_text": r.get("text"),
        "needs_note": r.get("needs_note"),
        "outcome": r.get("outcome"),
        "ground_truth_note": r.get("ground_truth_note"),
        "judge_guidance": r.get("judge_guidance"),
        "original_note_text": r.get("original_note_text"),
        "failure_reason_from_annotation": r.get("failure_reason"),
        "bot_proposed_note": r.get("note_text"),
        "bot_queries": cb.get("queries"),
        "bot_search_findings_preview": (cb.get("searchFindings") or "")[:2000],
        "writer_response": writer_response,
        "judge_decision": judge_content,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: 09_prep_failure_batches.py <run_folder>", file=sys.stderr)
        sys.exit(1)
    run = Path(sys.argv[1])
    out_dir = run / "_failure_batches"
    out_dir.mkdir(exist_ok=True)

    summary: dict[str, int] = {}
    all_trimmed: list[dict] = []
    for cat, _ in CATEGORIES:
        path = run / f"{cat}.json"
        if not path.exists():
            continue
        rows = json.loads(path.read_text())
        trimmed = [trim_row(r, cat) for r in rows]
        all_trimmed.extend(trimmed)
        summary[cat] = len(trimmed)
        (out_dir / f"{cat}.json").write_text(json.dumps(trimmed, indent=2))
        print(f"  {cat}: {len(trimmed)} rows  →  _failure_batches/{cat}.json")

    # Also write split batches for parallel agents:
    # - one batch for "proposed-but-wrong" (FP + incorrect, ~11 rows)
    # - three batches for "missed" (split ~13/13/14)
    proposed_wrong = [t for t in all_trimmed if t["category"] in ("non_note_worthy_incorrect", "note_worthy_incorrect")]
    missed = [t for t in all_trimmed if t["category"] == "note_worthy_not_proposed"]

    (out_dir / "batch_proposed_wrong.json").write_text(json.dumps(proposed_wrong, indent=2))
    print(f"  batch_proposed_wrong: {len(proposed_wrong)} rows")

    chunks = 3
    chunk_size = (len(missed) + chunks - 1) // chunks
    for i in range(chunks):
        chunk = missed[i * chunk_size:(i + 1) * chunk_size]
        if not chunk:
            continue
        (out_dir / f"batch_missed_{i}.json").write_text(json.dumps(chunk, indent=2))
        print(f"  batch_missed_{i}: {len(chunk)} rows")

    print(f"\nTotal failure rows: {sum(summary.values())}")


if __name__ == "__main__":
    main()
