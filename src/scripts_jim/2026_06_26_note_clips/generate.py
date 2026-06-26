"""
For every NOTE the pipeline produced from the liked claims + the Dylan claims,
emit two artifacts into ./output/:
  - <name>.mp4  : the YouTube clip for the claim's context (timestampSeconds →
                  endTimestampSeconds, with a little padding).
  - <name>.json : { note_text, claim, video_url, clip, verifier_reasoning,
                    source_evaluations:[{url, verdict, citations:[{quote,explanation}]}] }

Inputs are the run folders under dataset_runs/: each has a claims.json (video +
per-claim start/end) and a results CSV (note_text, outcome, logs). A row is a
note when outcome starts with "candidate". The structured verifier output lives
at logs.note_writer_steps.source_verifier.turn.N.messages.*.content.

    uv run src/scripts_jim/2026_06_26_note_clips/generate.py
"""

import csv
import glob
import json
import os
import re
import subprocess

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(os.path.dirname(__file__), "output")

# Run folders to harvest notes from: the latest liked rerun (Dylan is handled
# separately and not re-run here).
RUN_GLOBS = [
    "dataset_runs/youtube-claims-liked_*_rerun-*",
]

CLIP_PAD_S = 2          # padding on each side of the context span
MIN_CLIP_S = 6          # ensure a watchable minimum length


def youtube_id(video: dict) -> str:
    m = re.search(r"(?:v=|youtu\.be/)([\w-]{11})", video.get("url", ""))
    return m.group(1) if m else video.get("id", "")


def slug(text: str, n: int = 6) -> str:
    words = re.sub(r"[^a-z0-9 ]", "", text.lower()).split()[:n]
    return "_".join(words) or "claim"


def claim_index(logs: dict):
    tw = logs.get("tweet", {}) if isinstance(logs, dict) else {}
    idx = tw.get("index")
    return idx if isinstance(idx, int) else None


def find_verifier_content(o):
    """Last dict in the log tree that carries source_evaluations (the final turn)."""
    found = []
    def walk(x):
        if isinstance(x, dict):
            if "source_evaluations" in x:
                found.append(x)
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(o)
    return found[-1] if found else {}


def cut_clip(vid: str, start: float, end: float, out_base: str) -> str | None:
    s = max(0, int(start) - CLIP_PAD_S)
    e = int(end) + CLIP_PAD_S
    if e - s < MIN_CLIP_S:
        e = s + MIN_CLIP_S
    try:
        subprocess.run(
            ["yt-dlp", "--no-warnings", "--download-sections", f"*{s}-{e}",
             "--force-keyframes-at-cuts", "--recode-video", "mp4",
             "-f", "bv*[height<=720]+ba/b[height<=720]/b",
             "-o", f"{out_base}.%(ext)s", f"https://www.youtube.com/watch?v={vid}"],
            check=True, capture_output=True, timeout=600,
        )
    except subprocess.CalledProcessError as err:
        print(f"    !! yt-dlp failed: {err.stderr.decode()[-200:]}")
        return None
    mp4 = f"{out_base}.mp4"
    return mp4 if os.path.exists(mp4) else None


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    folders = []
    for g in RUN_GLOBS:
        folders += glob.glob(os.path.join(REPO, g))

    # Keep only the latest folder per run (strip the trailing -YYYY-MM-DD-HHMM stamp).
    latest: dict[str, str] = {}
    for f in sorted(folders):
        key = re.sub(r"-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?$", "", os.path.basename(f))
        latest[key] = f

    total = 0
    for folder in sorted(latest.values()):
        claims_doc = json.load(open(os.path.join(folder, "claims.json"), encoding="utf-8"))
        claims = claims_doc["claims"]
        vid = youtube_id(claims_doc["video"])
        csv_path = glob.glob(os.path.join(folder, "results_*.csv"))[0]
        rows = [r for r in csv.DictReader(open(csv_path, encoding="utf-8")) if (r["outcome"] or "").startswith("candidate")]
        print(f"\n=== {os.path.basename(folder)} — {len(rows)} note(s) ===")

        for r in rows:
            logs = json.loads(r["logs"]) if r["logs"] else {}
            idx = claim_index(logs)
            claim = claims[idx - 1] if idx and 1 <= idx <= len(claims) else {}
            start = claim.get("timestampSeconds")
            end = claim.get("endTimestampSeconds", start)
            content = find_verifier_content(logs)
            evals = [
                {"url": e.get("url"), "verdict": e.get("verdict"),
                 "citations": e.get("citations", [])}
                for e in content.get("source_evaluations", [])
            ]

            name = f"{vid}_{idx}_{slug(claim.get('claim', r['text']))}"
            total += 1
            print(f"  [{name}] start={start} end={end} sources={len(evals)}")

            doc = {
                "note_text": r["note_text"],
                "claim": claim.get("claim"),
                "context": claim.get("context"),
                "video_url": f"https://www.youtube.com/watch?v={vid}&t={int(start)}s" if start is not None else None,
                "clip": {"start_s": start, "end_s": end, "file": f"{name}.mp4"},
                "verifier_reasoning": content.get("reasoning"),
                "source_evaluations": evals,
            }
            json.dump(doc, open(os.path.join(OUT, f"{name}.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)

            if start is not None:
                mp4 = cut_clip(vid, start, end if end is not None else start, os.path.join(OUT, name))
                print(f"    {'wrote ' + os.path.basename(mp4) if mp4 else 'NO clip'}")

    print(f"\nDone — {total} notes → {OUT}")


if __name__ == "__main__":
    main()
