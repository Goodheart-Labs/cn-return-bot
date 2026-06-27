"""
Final deliverable: for every note we produced (Dylan + the liked claims, across
several runs), emit into ./output/:
  - <name>.mp4  : the YouTube clip for the claim's transcript span.
  - <name>.json : { note_text, claim, context, video_url, clip,
                    source_verification: { accepted, reasoning,
                      source_evaluations:[{url, verdict, citations:[{quote,explanation}]}] } }

Notes live in different run folders (we re-ran to get the pipeline to produce a
note). TARGETS lists the chosen run per group. Candidate rows (outcome starts
"candidate") are harvested automatically; OVERRIDES additionally pulls a
specific non-candidate row and rewrites its note text (the jensen China note,
with the unsupported "U.S. 36.1%" sentence removed by hand).

    uv run src/scripts_jim/2026_06_26_note_clips/generate_final.py
"""

import csv
import glob
import json
import os
import re
import subprocess

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(os.path.dirname(__file__), "output")

CLIP_PAD_S = 2
MIN_CLIP_S = 6

# Chosen run folder per group — harvest every candidate note from each.
TARGETS = [
    "dataset_runs/youtube-claims-dylan_patel_opus48-2026-06-25-2043",
    "dataset_runs/youtube-claims-liked_michael_nielson_rerun-2026-06-26-1443",
    "dataset_runs/youtube-claims-liked_phil_trammel_podcast_opus47-2026-06-26-1559",
    "dataset_runs/youtube-claims-liked_jensen_huang_podcast_opus47-2026-06-26-1609",
]

# Non-candidate notes to include anyway, with a manual edit to the note text.
# (folder, claim_index, edit_fn)
def _drop_us_361(note: str) -> str:
    note = re.sub(r"\s*Data from the ITIF 2026 Hamilton Index shows.*?of global output\.\s*", " ", note)
    return re.sub(r"\s{2,}", " ", note).strip()

OVERRIDES = [
    ("dataset_runs/youtube-claims-liked_jensen_huang_podcast_opus47-2026-06-26-1609", 1, _drop_us_361),
]


def youtube_id(video: dict) -> str:
    m = re.search(r"(?:v=|youtu\.be/)([\w-]{11})", video.get("url", ""))
    return m.group(1) if m else video.get("id", "")


def slug(text: str, n: int = 6) -> str:
    words = re.sub(r"[^a-z0-9 ]", "", (text or "").lower()).split()[:n]
    return "_".join(words) or "claim"


def claim_index(logs: dict):
    idx = (logs.get("tweet", {}) if isinstance(logs, dict) else {}).get("index")
    return idx if isinstance(idx, int) else None


def find_verifier_content(o):
    """Last dict in the log tree carrying source_evaluations (the final turn)."""
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


def source_verification(logs: dict) -> dict:
    c = find_verifier_content(logs)
    evals = [
        {"url": e.get("url"), "verdict": e.get("verdict"),
         "citations": e.get("citations", [])}
        for e in c.get("source_evaluations", [])
    ]
    return {"accepted": c.get("accepted"), "reasoning": c.get("reasoning"), "source_evaluations": evals}


def cut_clip(vid: str, start: float, end: float, out_base: str):
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


def emit(folder: str, row: dict, claims: list, vid: str, note_text: str, manual_edit: str | None) -> None:
    logs = json.loads(row["logs"]) if row["logs"] else {}
    idx = claim_index(logs)
    claim = claims[idx - 1] if idx and 1 <= idx <= len(claims) else {}
    start = claim.get("timestampSeconds")
    end = claim.get("endTimestampSeconds", start)
    name = f"{vid}_{idx}_{slug(claim.get('claim', note_text))}"
    print(f"  [{name}] start={start} end={end}")

    doc = {
        "note_text": note_text,
        "claim": claim.get("claim"),
        "context": claim.get("context"),
        "video_url": f"https://www.youtube.com/watch?v={vid}&t={int(start)}s" if start is not None else None,
        "clip": {"start_s": start, "end_s": end, "file": f"{name}.mp4"},
        "source_verification": source_verification(logs),
    }
    if manual_edit:
        doc["manual_edit"] = manual_edit
    json.dump(doc, open(os.path.join(OUT, f"{name}.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    if start is not None:
        mp4 = cut_clip(vid, start, end if end is not None else start, os.path.join(OUT, name))
        print(f"    {'wrote ' + os.path.basename(mp4) if mp4 else 'NO clip'}")


def load(folder: str):
    full = os.path.join(REPO, folder)
    claims = json.load(open(os.path.join(full, "claims.json"), encoding="utf-8"))
    vid = youtube_id(claims["video"])
    csv_path = glob.glob(os.path.join(full, "results_*.csv"))[0]
    rows = list(csv.DictReader(open(csv_path, encoding="utf-8")))
    return claims["claims"], vid, rows


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, "*")):
        os.remove(f)

    total = 0
    for folder in TARGETS:
        claims, vid, rows = load(folder)
        cands = [r for r in rows if (r["outcome"] or "").startswith("candidate")]
        print(f"\n=== {os.path.basename(folder)} — {len(cands)} candidate(s) ===")
        for r in cands:
            emit(folder, r, claims, vid, r["note_text"], None)
            total += 1

    for folder, idx, edit_fn in OVERRIDES:
        claims, vid, rows = load(folder)
        row = next((r for r in rows if claim_index(json.loads(r["logs"])) == idx), None)
        if not row:
            print(f"\n!! override claim {idx} not found in {folder}")
            continue
        edited = edit_fn(row["note_text"])
        print(f"\n=== OVERRIDE {os.path.basename(folder)} claim {idx} (manual edit) ===")
        print(f"    before: {row['note_text'][:140]!r}")
        print(f"    after:  {edited[:140]!r}")
        emit(folder, row, claims, vid, edited, "Removed unsupported 'U.S. 36.1% of IT/information services' sentence (not on the cited ITIF page).")
        total += 1

    print(f"\nDone — {total} notes → {OUT}")


if __name__ == "__main__":
    main()
