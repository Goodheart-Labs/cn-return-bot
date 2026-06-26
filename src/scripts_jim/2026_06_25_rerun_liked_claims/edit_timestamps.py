"""
Migrate already-extracted claims.json files to the new shape:
  - drop `quote` (the full `context` replaces it),
  - `timestampSeconds` = START of the context (not the old quote anchor),
  - `endTimestampSeconds` = END of the context (so we can later cut clips),
  - refresh `videoLink` to the context start.

Operates in place on the 4 files produced this session: the 3 liked-claims
outputs here + the Dylan `--url` extraction under dataset_runs/. Start/end come
from aligning the context's head/tail words to the YouTube caption stream
(per-word start/end), reusing the sibling backfill's caption helpers.

    uv run src/scripts_jim/2026_06_25_rerun_liked_claims/edit_timestamps.py
"""

import difflib
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "2026_06_25_podcast_video_links"))
import backfill as bf  # vtt_timestamp_to_seconds, normalize_words, REPO_ROOT

ANCHOR_WORDS = 12  # head/tail words used to pin the context's start/end


def youtube_id(video: dict) -> str:
    m = re.search(r"(?:v=|youtu\.be/)([\w-]{11})", video.get("url", ""))
    if m:
        return m.group(1)
    vid = video.get("id", "")
    if re.fullmatch(r"[\w-]{11}", vid):
        return vid
    raise RuntimeError(f"can't resolve YouTube id from {video!r}")


def fetch_words(vid: str) -> tuple[list[str], list[float], list[float]]:
    """Caption word stream with per-word (start, end) — each word inherits its cue's bounds."""
    url = f"https://www.youtube.com/watch?v={vid}"
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(
            ["yt-dlp", "--write-auto-subs", "--sub-lang", "en", "--sub-format", "vtt",
             "--skip-download", "--no-warnings", "-o", os.path.join(d, "%(id)s.%(ext)s"), url],
            check=True, capture_output=True, timeout=300,
        )
        content = open(glob.glob(os.path.join(d, "*.vtt"))[0], encoding="utf-8").read()

    words: list[str] = []
    starts: list[float] = []
    ends: list[float] = []
    last = None
    for block in content.split("\n\n"):
        lines = block.splitlines()
        cue = next((l for l in lines if "-->" in l), None)
        if not cue:
            continue
        a, b = cue.split("-->")
        s = bf.vtt_timestamp_to_seconds(a.strip().split()[0])
        e = bf.vtt_timestamp_to_seconds(b.strip().split()[0])
        text = " ".join(lines[lines.index(cue) + 1:])
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"&[a-z]+;", " ", text).strip()
        if not text or text == last:
            continue
        last = text
        for w in bf.normalize_words(text):
            words.append(w)
            starts.append(s)
            ends.append(e)
    return words, starts, ends


def context_span(context: str, words, starts, ends) -> tuple[float | None, float | None]:
    cw = bf.normalize_words(context)
    if not cw:
        return None, None
    hm = difflib.SequenceMatcher(None, words, cw[:ANCHOR_WORDS], autojunk=False).find_longest_match(0, len(words), 0, min(ANCHOR_WORDS, len(cw)))
    tm = difflib.SequenceMatcher(None, words, cw[-ANCHOR_WORDS:], autojunk=False).find_longest_match(0, len(words), 0, min(ANCHOR_WORDS, len(cw)))
    start = starts[hm.a] if hm.size else None
    end = ends[tm.a + tm.size - 1] if tm.size else None
    if start is not None and end is not None and end < start:  # ambiguous anchors → full-context match
        fm = difflib.SequenceMatcher(None, words, cw, autojunk=False).find_longest_match(0, len(words), 0, len(cw))
        if fm.size:
            start, end = starts[fm.a], ends[fm.a + fm.size - 1]
    return start, end


def main() -> None:
    files = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "output", "claims_*.json")))
    files += sorted(glob.glob(os.path.join(bf.REPO_ROOT, "dataset_runs", "youtube-claims-dylan_patel-*", "claims.json")))

    for f in files:
        doc = json.load(open(f, encoding="utf-8"))
        vid = youtube_id(doc["video"])
        words, starts, ends = fetch_words(vid)
        located = 0
        for c in doc["claims"]:
            c.pop("quote", None)
            s, e = context_span(c.get("context", ""), words, starts, ends)
            if s is not None:
                c["timestampSeconds"] = int(s)
                c["videoLink"] = f"https://www.youtube.com/watch?v={vid}&t={int(s)}s"
                located += 1
            else:
                c.pop("timestampSeconds", None)
                c.pop("videoLink", None)
            c["endTimestampSeconds"] = int(e) if e is not None else None
        json.dump(doc, open(f, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        rel = os.path.relpath(f, bf.REPO_ROOT)
        print(f"{rel}: {len(doc['claims'])} claims · {located} located ({vid})")


if __name__ == "__main__":
    main()
