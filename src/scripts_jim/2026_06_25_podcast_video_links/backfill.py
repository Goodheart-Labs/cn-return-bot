"""
Backfill podcast review-dashboard uploads.

Two fixes for the 5 existing `podcasts_*` uploads, which were run from a
timestamp-less `--transcript-file` (empty `url`, empty `result`):

  1. result     : "note" / "no_note" from the stored `outcome`
                  (candidate -> note, else no_note). Drives the Note/No Note pills.
  2. url        : a timestamped YouTube deep-link, by fuzzy-matching each claim's
                  verbatim quote (kept locally in podcast_results/.../results.json)
                  against the video's YouTube auto-caption transcript.
  3. tweet_text : "Text from Transcript: <quote>\nClaim: <claim>" so the reviewer
                  sees the original wording, not just the neutral claim.

The site (Dwarkesh) transcript and the YouTube auto-captions are NOT identical,
so we align word streams with difflib rather than exact substring matching.

Dry-run by default (prints match rates + the unmatched worklist); pass --write
to apply, --label <name> to limit to one upload.

    uv run src/scripts_jim/2026_06_25_podcast_video_links/backfill.py
    uv run src/scripts_jim/2026_06_25_podcast_video_links/backfill.py --write
"""

import argparse
import difflib
import glob
import json
import os
import re
import subprocess
import sys
import tempfile

import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PODCAST_RESULTS_DIR = os.path.join(REPO_ROOT, "podcast_results")

# Resolved Dwarkesh Podcast videos (verified against the transcript openings in
# src/scripts_jim/2026_06_18_dwarkesh_transcripts/).
VIDEO_IDS = {
    "jensen_huang": "Hrbq66XqtCo",
    "dylan_patel": "mDG_Hx3BSUE",
    "ada_palmer": "U1FrhkLQnCI",
    "michael_nielson": "myP8UjAM1pk",
    "phil_trammel": "Jj-kBHzUohs",
}

MATCH_SCORE_THRESHOLD = 0.6   # matched words / quote words
MIN_QUOTE_WORDS = 4           # too-short quotes can't be located reliably
BACKWARD_JUMP_TOLERANCE_S = 600  # monotonicity: flag matches that jump back this far


# ── normalization ──────────────────────────────────────────────────────────

def normalize_words(text: str) -> list[str]:
    return re.sub(r"[^a-z0-9 ]", " ", text.lower()).split()


# ── YouTube transcript ─────────────────────────────────────────────────────

def vtt_timestamp_to_seconds(ts: str) -> float:
    h, m, s = ts.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def fetch_youtube_word_stream(video_id: str) -> tuple[list[str], list[float]]:
    """yt-dlp auto-captions -> (words, times) flat stream, one time per word."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(
            ["yt-dlp", "--write-auto-subs", "--sub-lang", "en", "--sub-format", "vtt",
             "--skip-download", "--no-warnings", "-o", os.path.join(d, "%(id)s.%(ext)s"), url],
            check=True, capture_output=True, timeout=300,
        )
        vtts = glob.glob(os.path.join(d, "*.vtt"))
        if not vtts:
            raise RuntimeError(f"no VTT produced for {video_id}")
        content = open(vtts[0], encoding="utf-8").read()

    words: list[str] = []
    times: list[float] = []
    last_line = None
    for block in content.split("\n\n"):
        lines = block.splitlines()
        cue_line = next((l for l in lines if "-->" in l), None)
        if not cue_line:
            continue
        start = vtt_timestamp_to_seconds(cue_line.split("-->")[0].strip().split()[0])
        text_lines = lines[lines.index(cue_line) + 1:]
        text = " ".join(text_lines)
        text = re.sub(r"<[^>]+>", "", text)  # inline word-timing tags
        text = re.sub(r"&[a-z]+;", " ", text)
        text = text.strip()
        if not text or text == last_line:  # auto-subs roll the previous line forward
            continue
        last_line = text
        for w in normalize_words(text):
            words.append(w)
            times.append(start)
    return words, times


# ── local claims (ordered; index matches logs.tweet.index) ─────────────────
#
# DB items join to local claims by their original claim index (logs.tweet.index,
# 1-based), NOT by text: prefilter-rejected items never stored their text. The
# local results.json preserves the full claim order (incl. skipped claims), so
# results[index - 1] is the right claim for every item.

def load_claims(label: str) -> list[dict]:
    matches = glob.glob(os.path.join(PODCAST_RESULTS_DIR, f"youtube-claims-{label}-*", "results.json"))
    if not matches:
        raise RuntimeError(f"no local results.json for {label}")
    return json.load(open(matches[0], encoding="utf-8"))["results"]


def item_claim_index(item: dict) -> int | None:
    logs = item.get("logs")
    if not isinstance(logs, dict):
        return None
    idx = logs.get("tweet", {}).get("index")
    return idx if isinstance(idx, int) else None


# ── fuzzy locate quote in the YT word stream ───────────────────────────────

def locate(quote: str, y_words: list[str], y_times: list[float]):
    """Return (timestamp, score) for the best alignment of `quote` in the stream."""
    q = normalize_words(quote)
    if len(q) < MIN_QUOTE_WORDS:
        return None, 0.0
    sm = difflib.SequenceMatcher(None, y_words, q, autojunk=False)
    longest = sm.find_longest_match(0, len(y_words), 0, len(q))
    matched = sum(b.size for b in sm.get_matching_blocks())
    score = matched / len(q)
    if longest.size == 0:
        return None, score
    return y_times[longest.a], score


# ── supabase ───────────────────────────────────────────────────────────────

def get_uploads() -> list[dict]:
    r = requests.get(f"{SUPABASE_URL}/rest/v1/review_dashboard_uploads",
                     headers=HEADERS, params={"select": "id,name"})
    r.raise_for_status()
    return r.json()


def get_items(upload_id: str) -> list[dict]:
    r = requests.get(f"{SUPABASE_URL}/rest/v1/review_dashboard_items", headers=HEADERS,
                     params={"upload_id": f"eq.{upload_id}",
                             "select": "id,tweet_text,outcome,url,result,logs", "limit": "5000"})
    r.raise_for_status()
    return r.json()


def patch_item(item_id: str, payload: dict) -> None:
    r = requests.patch(f"{SUPABASE_URL}/rest/v1/review_dashboard_items",
                       headers={**HEADERS, "Content-Type": "application/json",
                                "Prefer": "return=minimal"},
                       params={"id": f"eq.{item_id}"}, json=payload)
    r.raise_for_status()


# ── per-upload backfill ────────────────────────────────────────────────────

def backfill_upload(label: str, upload: dict, write: bool) -> None:
    print(f"\n=== {upload['name']} ({label}) ===")
    items = get_items(upload["id"])
    claims = load_claims(label)
    video_id = VIDEO_IDS[label]
    y_words, y_times = fetch_youtube_word_stream(video_id)
    print(f"  {len(items)} items · {len(claims)} local claims · {len(y_words)} caption words")

    matched = 0
    text_set = 0
    unmatched: list[tuple[str, float]] = []
    plan: list[tuple[str, dict]] = []

    for it in items:
        outcome = it.get("outcome") or ""
        payload = {"result": "note" if outcome.startswith("candidate") else "no_note"}

        idx = item_claim_index(it)
        claim = claims[idx - 1] if idx and 1 <= idx <= len(claims) else None
        claim_text = (claim or {}).get("claim", "")
        quote = (claim or {}).get("quote", "")

        # Content the fact-checker / reviewer sees: transcript citation + claim.
        # Old runs only have the short `quote` (no full `context`), so use it.
        if claim_text:
            payload["tweet_text"] = (
                f"Text from Transcript: {quote}\nClaim: {claim_text}" if quote.strip()
                else f"Claim: {claim_text}"
            )
            text_set += 1

        t, score = locate(quote, y_words, y_times) if quote else (None, 0.0)
        if t is not None and score >= MATCH_SCORE_THRESHOLD:
            payload["url"] = f"https://www.youtube.com/watch?v={video_id}&t={int(t)}s"
            matched += 1
        else:
            unmatched.append((claim_text[:70] or "(no claim found)", score))
        plan.append((it["id"], payload))

    rate = matched / len(items) if items else 0
    print(f"  url matched: {matched}/{len(items)} ({rate:.0%}) · tweet_text set: {text_set}")
    if unmatched:
        print(f"  unmatched ({len(unmatched)}) — fix urls by hand:")
        for text, score in unmatched:
            print(f"    [{score:.2f}] {text}")

    if write:
        for item_id, payload in plan:
            patch_item(item_id, payload)
        print(f"  WROTE {len(plan)} items (result + transcript+claim text always; url for matched)")
    else:
        print("  dry-run (pass --write to apply)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--label", help="only this upload (e.g. jensen_huang)")
    args = ap.parse_args()

    uploads = {u["name"]: u for u in get_uploads()}
    labels = [args.label] if args.label else list(VIDEO_IDS)
    for label in labels:
        upload = uploads.get(f"podcasts_{label}")
        if not upload:
            print(f"\n!! no upload named podcasts_{label} (have: {sorted(uploads)})", file=sys.stderr)
            continue
        backfill_upload(label, upload, args.write)


if __name__ == "__main__":
    main()
