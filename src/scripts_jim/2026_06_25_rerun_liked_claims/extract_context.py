"""
Re-extract a hand-picked list of liked claims with their FULL transcript context,
so they can be re-run through `checkYoutubeClaims --claims <file>` against the
updated source verifier.

For each claim we already know the source podcast and the original short quote
(from the local podcast_results). This script:
  1. locates the quote in the clean (Dwarkesh site) transcript and takes a window
     around it,
  2. asks Opus to produce the regular-extraction fields for that claim —
     `context` (full-context verbatim excerpt), `quote`, `judgement`,
  3. snaps the quote to the YouTube captions for `timestampSeconds` + `videoLink`.

Output mirrors the regular `claims.json` format, one file per source video, under
this folder's `output/`. Reuses the transcript/locate helpers from the sibling
backfill script.

    uv run src/scripts_jim/2026_06_25_rerun_liked_claims/extract_context.py
"""

import json
import os
import re
import sys

import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "2026_06_25_podcast_video_links"))
import backfill as bf  # fetch_youtube_word_stream, locate, load_claims, VIDEO_IDS, REPO_ROOT

load_dotenv()
OPENROUTER_KEY = os.environ["OPENROUTER_API_KEY"]
MODEL = "anthropic/claude-opus-4.6"  # same model the regular extraction uses

OUT_DIR = os.path.join(os.path.dirname(__file__), "output")
TRANSCRIPT_DIR = os.path.join(bf.REPO_ROOT, "src", "scripts_jim", "2026_06_18_dwarkesh_transcripts")

JUDGEMENTS = [
    "certainly true", "likely true", "somewhat likely true", "uncertain",
    "somewhat likely false", "likely false", "certainly false",
]

# yt-dlp %(upload_date)s (ISO) — the video's publish date, used as the claim's date.
UPLOAD_DATES = {
    "jensen_huang": "2026-04-15", "michael_nielson": "2026-04-07", "phil_trammel": "2026-06-04",
    "dylan_patel": "2026-03-13", "ada_palmer": "2026-06-16",
}

# (source label, exact claim text) — resolved to its original quote from the local data.
LIKED = [
    ("jensen_huang", "China represents approximately 40% of the world's technology industry."),
    ("jensen_huang", "Nvidia has been more than tripling the amount of flops it provides to the world year over year."),
    ("jensen_huang", "Huawei shipped millions of AI chips in a recent year."),
    ("michael_nielson", "Aristarchus proposed heliocentrism in the second century BC."),
    ("phil_trammel", "Atkinson published a paper showing that if accounting methods are kept constant over time, labor share has not fallen."),
]

WINDOW_CHARS = 1600  # transcript context shown to Opus on each side of the quote

SYSTEM_PROMPT = (
    "You are given a target factual claim and the transcript segment it comes from.\n"
    "Return a JSON object with:\n"
    '- "context": a VERBATIM excerpt from the transcript around the claim — its '
    "sentence plus enough surrounding sentences that a reader with none of the rest "
    "of the transcript has all the context needed to evaluate the claim. Quote the "
    "transcript verbatim; do not paraphrase.\n"
    '- "quote": the short verbatim span the claim rests on most directly (a subset of context).\n'
    f'- "judgement": how true the claim is, using only your own knowledge — one of: {", ".join(JUDGEMENTS)}.\n'
    "Return ONLY the JSON object."
)


def resolve_quote(label: str, claim_text: str) -> str:
    for c in bf.load_claims(label):
        if c.get("claim", "").strip() == claim_text.strip():
            return c.get("quote", "")
    raise RuntimeError(f"claim not found in {label} results.json: {claim_text!r}")


def _normalize_with_map(text: str) -> tuple[str, list[int]]:
    """Lowercased, punctuation-stripped, whitespace-collapsed text + a map from each
    normalized-char index back to its original index (so we can slice the original)."""
    norm: list[str] = []
    orig_idx: list[int] = []
    prev_space = True
    for i, ch in enumerate(text):
        if ch.isalnum():
            norm.append(ch.lower())
            orig_idx.append(i)
            prev_space = False
        elif not prev_space:
            norm.append(" ")
            orig_idx.append(i)
            prev_space = True
    return "".join(norm), orig_idx


def transcript_window(label: str, quote: str) -> str:
    """A window of the ORIGINAL (clean) transcript around the quote, located via a
    normalized search so curly-quote / whitespace drift can't miss it."""
    text = open(os.path.join(TRANSCRIPT_DIR, f"{label}.txt"), encoding="utf-8").read()
    norm_text, orig_idx = _normalize_with_map(text)
    nq = re.sub(r"\s+", " ", re.sub(r"[^\w ]", " ", quote.lower())).strip()
    p = norm_text.find(nq)
    if p == -1:  # fall back to the first ~8 words of the quote
        p = norm_text.find(" ".join(nq.split()[:8]))
    if p == -1:
        return text[: WINDOW_CHARS * 2]  # last resort: the opening
    o_start = orig_idx[p]
    o_end = orig_idx[min(p + len(nq), len(orig_idx) - 1)]
    return text[max(0, o_start - WINDOW_CHARS) : min(len(text), o_end + WINDOW_CHARS)]


def opus_extract(claim_text: str, window: str, tries: int = 4) -> dict:
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Target claim:\n{claim_text}\n\nTranscript segment:\n{window}"},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 4000,
    }
    last = ""
    for _ in range(tries):
        r = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"},
            json=body, timeout=300,
        )
        r.raise_for_status()
        last = (r.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
        m = re.search(r"\{.*\}", last, re.DOTALL)  # tolerate fences / stray prose
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    raise RuntimeError(f"opus_extract failed after {tries} tries; last content: {last[:300]!r}")


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    # group claims by source video, caching each video's caption stream
    by_label: dict[str, list[dict]] = {}
    streams: dict[str, tuple[list[str], list[float]]] = {}

    for label, claim_text in LIKED:
        vid = bf.VIDEO_IDS[label]
        if label not in streams:
            print(f"[fetch captions] {label} ({vid})")
            streams[label] = bf.fetch_youtube_word_stream(vid)
        y_words, y_times = streams[label]

        quote0 = resolve_quote(label, claim_text)
        window = transcript_window(label, quote0)
        out = opus_extract(claim_text, window)

        claim = {"claim": claim_text, "judgement": out["judgement"], "quote": out["quote"], "context": out["context"]}
        t, score = bf.locate(out["quote"], y_words, y_times)
        if t is None or score < 0.4:  # fall back to the original quote for the timestamp
            t, score = bf.locate(quote0, y_words, y_times)
        if t is not None:
            claim["timestampSeconds"] = int(t)
            claim["videoLink"] = f"https://www.youtube.com/watch?v={vid}&t={int(t)}s"
        by_label.setdefault(label, []).append(claim)
        ts = f"{int(t)//60:02d}:{int(t)%60:02d}" if t is not None else "??"
        print(f"  [{label}] t={ts} score={score:.2f} :: {claim_text[:60]}")

    for label, claims in by_label.items():
        vid = bf.VIDEO_IDS[label]
        doc = {
            "video": {"url": f"https://www.youtube.com/watch?v={vid}", "id": label, "title": label,
                      "uploadDate": UPLOAD_DATES.get(label)},
            "range": {"beginMin": 0, "endMin": None},
            "claims": claims,
        }
        path = os.path.join(OUT_DIR, f"claims_{label}.json")
        json.dump(doc, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        print(f"wrote {path} ({len(claims)} claims)")


if __name__ == "__main__":
    main()
