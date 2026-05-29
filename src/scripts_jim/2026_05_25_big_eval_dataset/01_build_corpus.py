"""
Phase 1 of the big_eval build: assemble the candidate corpus + availability report.

Sources:
  - X CN public dump, filtered to the AI-notewriter author IDs in ai_author_ids.txt:
      notes-*.tsv               -> note text (summary), tweetId, classification, author
      noteStatusHistory-*.tsv   -> currentStatus (HELPFUL / NEEDS_MORE_RATINGS / NOT_HELPFUL)
      ratings-*.tsv (~40 GB)    -> per-reason notHelpful*/helpful* tag counts + helpfulness tallies
  - Supabase: helpful notes on tweets we processed (ours + competing) with tweet
    impressions/view_count — the high-signal pool for the "excellence" categories.

Reuses the proven download + ratings-aggregation helpers in src/production/fill_ratings.py
(its aggregate_ratings already takes a *set* of note ids, so it generalizes to N authors).

Staged + resumable (intermediates cached under datasets/big_eval/_cache/):
  uv run .../01_build_corpus.py notes     # download notes+status, filter to authors  (fast)
  uv run .../01_build_corpus.py ratings   # stream ratings, aggregate tags            (slow, 40GB)
  uv run .../01_build_corpus.py db        # pull DB helpful pool                       (fast)
  uv run .../01_build_corpus.py merge     # write corpus.jsonl + availability.md
  uv run .../01_build_corpus.py all       # everything in order
"""
import csv
import importlib.util
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent.parent.parent
BIG_EVAL = PROJECT_ROOT / "datasets" / "big_eval"
CACHE = BIG_EVAL / "_cache"
AUTHOR_IDS_FILE = BIG_EVAL / "ai_author_ids.txt"

load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

# Load fill_ratings.py by path (reuse its download + aggregation helpers without packaging).
_spec = importlib.util.spec_from_file_location("fill_ratings", PROJECT_ROOT / "src" / "production" / "fill_ratings.py")
fr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fr)

HELPFUL = "CURRENTLY_RATED_HELPFUL"
NMR = "NEEDS_MORE_RATINGS"
NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL"
STATUS_FILES = ["noteStatusHistory-00000.tsv"]
PAGE = 1000
# A note needs at least this many notHelpfulNoteNotNeeded ratings to count as a
# community "no note needed" signal (1 rating is noise).
MIN_NOTE_NOT_NEEDED_RATINGS = 2


def author_ids() -> set[str]:
    return {ln.strip() for ln in AUTHOR_IDS_FILE.read_text().splitlines() if ln.strip()}


# ── Stage: notes + status ──────────────────────────────────────────────────────

def stage_notes() -> None:
    fr.CN_DATA_DIR.mkdir(parents=True, exist_ok=True)
    authors = author_ids()
    print(f"[notes] {len(authors)} author ids")

    for fname in fr.NOTE_FILES:
        if not (fr.CN_DATA_DIR / fname).exists() and not fr.try_download_partition("notes", fname):
            raise SystemExit(f"failed to download {fname}")
    for fname in STATUS_FILES:
        if not (fr.CN_DATA_DIR / fname).exists() and not fr.try_download_partition("noteStatusHistory", fname):
            raise SystemExit(f"failed to download {fname}")

    notes: dict[str, dict] = {}
    for fname in fr.NOTE_FILES:
        with (fr.CN_DATA_DIR / fname).open() as f:
            for row in csv.DictReader(f, delimiter="\t"):
                aid = row.get("noteAuthorParticipantId") or row.get("participantId")
                if aid not in authors:
                    continue
                notes[row["noteId"]] = {
                    "note_id": row["noteId"],
                    "tweet_id": row.get("tweetId"),
                    "author_id": aid,
                    "note_text": row.get("summary") or "",
                    "classification": row.get("classification") or "",
                    "created_at_ms": int(row.get("createdAtMillis") or 0),
                    "is_media_note": row.get("isMediaNote") == "1",
                }
        print(f"[notes] {fname}: cumulative {len(notes)} author notes")

    status: dict[str, str] = {}
    for fname in STATUS_FILES:
        with (fr.CN_DATA_DIR / fname).open() as f:
            for row in csv.DictReader(f, delimiter="\t"):
                if row["noteId"] in notes:
                    status[row["noteId"]] = row.get("currentStatus") or ""
    for nid, n in notes.items():
        n["current_status"] = status.get(nid, "")

    CACHE.mkdir(parents=True, exist_ok=True)
    with (CACHE / "author_notes.jsonl").open("w") as f:
        for n in notes.values():
            f.write(json.dumps(n) + "\n")
    print(f"[notes] wrote {len(notes)} -> _cache/author_notes.jsonl")

    # Quick availability preview.
    per_author = Counter(n["author_id"] for n in notes.values())
    per_status = Counter(n["current_status"] for n in notes.values())
    print("\n[notes] per-author counts:")
    for aid, c in per_author.most_common():
        print(f"    {aid[:12]}…  {c}")
    print("\n[notes] status breakdown:")
    for s, c in per_status.most_common():
        print(f"    {s or '(none)'}: {c}")


def load_author_notes() -> dict[str, dict]:
    out = {}
    with (CACHE / "author_notes.jsonl").open() as f:
        for ln in f:
            n = json.loads(ln)
            out[n["note_id"]] = n
    return out


# ── Stage: ratings (slow) ──────────────────────────────────────────────────────

def stage_ratings() -> None:
    notes = load_author_notes()
    note_ids = set(notes)
    print(f"[ratings] aggregating tags for {len(note_ids)} notes (streaming ~40GB)…")
    aggregates = fr.aggregate_ratings(note_ids, stream=True)
    out = {}
    for nid, agg in aggregates.items():
        out[nid] = {
            "helpful_count": agg["helpful_count"],
            "somewhat_helpful_count": agg["somewhat_helpful_count"],
            "not_helpful_count": agg["not_helpful_count"],
            "helpful_tag_counts": fr.prune_zero_tags(agg["helpful_tag_counts"]),
            "not_helpful_tag_counts": fr.prune_zero_tags(agg["not_helpful_tag_counts"]),
        }
    (CACHE / "ratings_agg.json").write_text(json.dumps(out))
    print(f"[ratings] wrote tags for {len(out)} notes -> _cache/ratings_agg.json")


# ── Stage: DB helpful pool ─────────────────────────────────────────────────────

def _paged(sb, table, select, status_col, status_val, order_key):
    out, last = [], None
    while True:
        q = sb.table(table).select(select).eq(status_col, status_val).not_.is_("note_text", "null").order(order_key).limit(PAGE)
        if last is not None:
            q = q.gt(order_key, last)
        rows = q.execute().data
        if not rows:
            break
        out.extend(rows)
        last = rows[-1][order_key]
        if len(rows) < PAGE:
            break
    return out


def stage_db() -> None:
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    competing = _paged(sb, "competing_notes", "note_id, tweet_id, note_text, created_at_millis",
                       "current_status", HELPFUL, "note_id")
    ours = _paged(sb, "notes", "note_id, tweet_id, note_text, submitted_at, view_count",
                  "cn_status", HELPFUL, "note_id")
    print(f"[db] {len(competing)} competing-helpful, {len(ours)} our-helpful")

    tweet_ids = sorted({r["tweet_id"] for r in competing + ours if r.get("tweet_id")})
    impressions: dict[str, dict] = {}
    for i in range(0, len(tweet_ids), 200):
        chunk = tweet_ids[i:i + 200]
        for t in sb.table("tweets").select("tweet_id, text, impressions, has_video").in_("tweet_id", chunk).execute().data:
            impressions[t["tweet_id"]] = t
    print(f"[db] fetched {len(impressions)} tweet rows for impressions/text")

    rows = []
    for r in competing:
        t = impressions.get(r["tweet_id"], {})
        rows.append({"note_id": r["note_id"], "tweet_id": r["tweet_id"], "note_text": r["note_text"],
                     "source": "db_competing_helpful", "current_status": HELPFUL,
                     "impressions": t.get("impressions"), "tweet_text": t.get("text"), "has_video": t.get("has_video")})
    for r in ours:
        t = impressions.get(r["tweet_id"], {})
        rows.append({"note_id": r["note_id"], "tweet_id": r["tweet_id"], "note_text": r["note_text"],
                     "source": "db_our_helpful", "current_status": HELPFUL, "view_count": r.get("view_count"),
                     "impressions": t.get("impressions"), "tweet_text": t.get("text"), "has_video": t.get("has_video")})
    with (CACHE / "db_helpful.jsonl").open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(f"[db] wrote {len(rows)} -> _cache/db_helpful.jsonl")


# ── Stage: merge + availability ────────────────────────────────────────────────

def dominant_not_helpful_reason(tag_counts: dict) -> str | None:
    if not tag_counts:
        return None
    return max(tag_counts.items(), key=lambda kv: kv[1])[0]


def stage_merge() -> None:
    notes = load_author_notes()
    ratings = json.loads((CACHE / "ratings_agg.json").read_text()) if (CACHE / "ratings_agg.json").exists() else {}
    db_rows = []
    if (CACHE / "db_helpful.jsonl").exists():
        with (CACHE / "db_helpful.jsonl").open() as f:
            db_rows = [json.loads(ln) for ln in f]

    corpus = []
    for nid, n in notes.items():
        agg = ratings.get(nid, {})
        rec = {**n, "source": "ai_author",
               "helpful_count": agg.get("helpful_count", 0),
               "somewhat_helpful_count": agg.get("somewhat_helpful_count", 0),
               "not_helpful_count": agg.get("not_helpful_count", 0),
               "helpful_tag_counts": agg.get("helpful_tag_counts", {}),
               "not_helpful_tag_counts": agg.get("not_helpful_tag_counts", {})}
        rec["rating_volume"] = rec["helpful_count"] + rec["somewhat_helpful_count"] + rec["not_helpful_count"]
        rec["dominant_not_helpful_reason"] = dominant_not_helpful_reason(rec["not_helpful_tag_counts"])
        corpus.append(rec)

    seen = {c["note_id"] for c in corpus}
    for r in db_rows:
        if r["note_id"] not in seen:
            corpus.append(r)
            seen.add(r["note_id"])

    with (BIG_EVAL / "corpus.jsonl").open("w") as f:
        for c in corpus:
            f.write(json.dumps(c) + "\n")
    print(f"[merge] wrote {len(corpus)} -> corpus.jsonl")
    write_availability(corpus)


def write_availability(corpus: list[dict]) -> None:
    ai = [c for c in corpus if c.get("source") == "ai_author"]
    db = [c for c in corpus if c.get("source", "").startswith("db_")]
    by_status = Counter(c.get("current_status", "") for c in ai)
    NOTE_NOT_NEEDED = "notHelpfulNoteNotNeeded"

    not_helpful = [c for c in ai if c.get("current_status") == NOT_HELPFUL]
    nmr = [c for c in ai if c.get("current_status") == NMR]
    reason_dist = Counter(c["dominant_not_helpful_reason"] for c in not_helpful if c.get("dominant_not_helpful_reason"))
    nmr_note_not_needed = [c for c in nmr if c.get("not_helpful_tag_counts", {}).get(NOTE_NOT_NEEDED, 0) >= MIN_NOTE_NOT_NEEDED_RATINGS]
    nh_note_not_needed = [c for c in not_helpful if c.get("not_helpful_tag_counts", {}).get(NOTE_NOT_NEEDED, 0) >= MIN_NOTE_NOT_NEEDED_RATINGS]

    lines = ["# big_eval availability\n",
             f"AI-author notes: **{len(ai)}**  |  DB helpful pool: **{len(db)}**\n",
             "## AI-author notes by status",
             *[f"- {s or '(none)'}: {c}" for s, c in by_status.most_common()],
             "\n## NOT_HELPFUL — dominant not-helpful reason",
             *[f"- {r}: {c}" for r, c in reason_dist.most_common()],
             "\n## 'No note needed' candidates (the adversarial half)",
             f"- NOT_HELPFUL with notHelpfulNoteNotNeeded>=2: **{len(nh_note_not_needed)}**",
             f"- NEEDS_MORE_RATINGS with notHelpfulNoteNotNeeded>=2: **{len(nmr_note_not_needed)}**",
             "\n## DB helpful pool (excellence candidates)",
             f"- competing-helpful: {sum(1 for c in db if c['source']=='db_competing_helpful')}",
             f"- our-helpful: {sum(1 for c in db if c['source']=='db_our_helpful')}",
             f"- with impressions>=100k: {sum(1 for c in db if (c.get('impressions') or 0) >= 100_000)}",
             f"- with video: {sum(1 for c in db if c.get('has_video'))}",
             ""]
    (BIG_EVAL / "availability.md").write_text("\n".join(lines))
    print("[merge] wrote availability.md")
    print("\n".join(lines))


STAGES = {"notes": stage_notes, "ratings": stage_ratings, "db": stage_db, "merge": stage_merge}

if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "all"
    if stage == "all":
        for fn in (stage_notes, stage_ratings, stage_db, stage_merge):
            fn()
    elif stage in STAGES:
        STAGES[stage]()
    else:
        raise SystemExit(f"unknown stage {stage!r}; choose from {list(STAGES) + ['all']}")
