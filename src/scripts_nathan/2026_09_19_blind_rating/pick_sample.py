# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Draws the fixed sample both raters will score blind.

A rater sees the post, the note and the source links, and nothing that reveals
the outcome. The outcome is already known here, which is the point: the moment
both raters finish, the forecasts resolve against it with no waiting.

Only matured notes are eligible, because an unresolved note cannot score a
forecast. Notes Nathan has already annotated on the review dashboard are
excluded, so nothing he scores is something he has read and judged before.

The draw is random with a fixed seed and the order is stored, so both raters
see the same notes in the same order and neither can be advantaged by it.
"""
import json
import os
import random
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

HERE = Path(__file__).parent
ENV = Path("/Users/natha/Documents/Source/cn-return-bot/.env")
SAMPLE_SIZE = 150
SEED = 20260919
MATURITY_DAYS = 7
WINDOW_START = "2026-08-07"

load_dotenv(ENV)

QUERY = """
with matured as (
  select n.note_id, n.tweet_id, n.cn_status, n.submitted_at
  from notes n
  where coalesce(n.submitted_at, n.first_seen_at) >= %(start)s
    and coalesce(n.submitted_at, n.first_seen_at) < now() - interval '%(days)s days'
    and n.note_id is not null
),
annotated as (
  select target_id from review_dashboard_annotations where source = 'production'
)
select m.note_id, m.tweet_id, m.cn_status, m.submitted_at,
       r.id as run_id, r.note_text, r.source_url,
       coalesce(f.text, t.text) as tweet_text,
       coalesce(f.author_handle, t.author_handle) as author_handle,
       -- Everything below was knowable when we decided to submit. The
       -- first_seen_* columns are frozen at first sight; the live engagement
       -- columns are refreshed later and are deliberately not selected.
       f.first_seen_impressions, f.first_seen_feed_size, f.posted_at,
       f.first_seen_at, f.author_followers, f.has_video, f.has_photo,
       f.media_count, f.raw_tweet -> 'note_request_suggestions' as note_requests,
       (select ps.score_value from pipeline_scores ps
        where ps.pipeline_run_id = r.id and ps.score_type = 'evaluation'
        limit 1) as eval_score
from matured m
join pipeline_runs r on r.note_id = m.note_id
left join feed_tweets f on f.tweet_id = m.tweet_id
left join tweets t on t.tweet_id = m.tweet_id
where m.note_id not in (select target_id from annotated)
  and r.note_text is not null and length(trim(r.note_text)) > 0
  and coalesce(f.text, t.text) is not null
"""


def main() -> None:
    password = os.environ["SUPABASE_DB_PASSWORD"]
    conn = psycopg2.connect(
        host="aws-1-eu-west-1.pooler.supabase.com",
        port=5432,
        user="postgres.ugytvkevhsmcpunfvncw",
        password=password,
        dbname="postgres",
        connect_timeout=15,
        options="-c default_transaction_read_only=on -c statement_timeout=60000",
    )
    try:
        with conn.cursor() as cur:
            cur.execute(QUERY, {"start": WINDOW_START, "days": MATURITY_DAYS})
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()

    # One row per note: a note joins one run, but guard against duplicates.
    by_note = {}
    for row in rows:
        by_note.setdefault(row["note_id"], row)
    pool = list(by_note.values())

    # A random draw of 150 yields about 10 helpful notes, too few to tell a
    # rater's judgement from chance. So the sample is stratified and the
    # proportions are disclosed to both raters: a forecaster told the base rate
    # of the set in front of them can still be scored for calibration, while
    # ranking gets the positives it needs.
    rng = random.Random(SEED)
    buckets = {"CURRENTLY_RATED_HELPFUL": [], "CURRENTLY_RATED_NOT_HELPFUL": [], "other": []}
    for row in pool:
        buckets.get(row["cn_status"], buckets["other"]).append(row)
    for rows_ in buckets.values():
        rng.shuffle(rows_)
    # Only 13 not-helpful notes survive the exclusion, because Nathan has
    # already annotated most of them: reviewing failures is what the dashboard
    # is for. Take all of them and fill the rest with unresolved notes.
    wanted = {"CURRENTLY_RATED_HELPFUL": 50, "CURRENTLY_RATED_NOT_HELPFUL": 13}
    sample = []
    for key, want in wanted.items():
        take = buckets[key][:want]
        if len(take) < want:
            raise SystemExit(f"only {len(take)} of {want} available for {key}")
        sample.extend(take)
    sample.extend(buckets["other"][: SAMPLE_SIZE - len(sample)])
    rng.shuffle(sample)

    helpful = sum(1 for r in sample if r["cn_status"] == "CURRENTLY_RATED_HELPFUL")
    not_helpful = sum(1 for r in sample if r["cn_status"] == "CURRENTLY_RATED_NOT_HELPFUL")

    out = []
    for i, r in enumerate(sample):
        urls = [u for u in (r["source_url"] or "").split() if u.startswith("http")]
        age_h = None
        velocity = None
        if r["posted_at"] and r["first_seen_at"]:
            age_h = (r["first_seen_at"] - r["posted_at"]).total_seconds() / 3600
            if r["first_seen_impressions"]:
                velocity = r["first_seen_impressions"] / max(age_h, 0.25)
        requests = r["note_requests"]
        out.append({
            "idx": i,
            "note_id": r["note_id"],
            "tweet_id": r["tweet_id"],
            "run_id": str(r["run_id"]),
            "tweet_text": r["tweet_text"],
            "author_handle": r["author_handle"],
            "note_text": r["note_text"],
            "sources": urls,
            # What the pipeline knew when it decided to submit. Shown to raters.
            "context": {
                "age_hours": round(age_h, 1) if age_h is not None else None,
                "impressions_at_sight": r["first_seen_impressions"],
                "velocity_per_hour": round(velocity) if velocity else None,
                "feed_tier": r["first_seen_feed_size"],
                "author_followers": r["author_followers"],
                "media": "video" if r["has_video"] else ("photo" if r["has_photo"] else None),
                "media_count": r["media_count"],
                "note_requests": len(requests) if isinstance(requests, list) else 0,
                "eval_score": round(float(r["eval_score"]), 2) if r["eval_score"] is not None else None,
            },
            # Held here so scoring needs no second pull. The server never sends it.
            "outcome": r["cn_status"],
            "submitted_at": r["submitted_at"].isoformat(),
        })

    data = HERE / "data"
    data.mkdir(exist_ok=True)
    (data / "sample.json").write_text(json.dumps(out, indent=1))
    meta = {
        "pool_size": len(pool),
        "sample_size": len(out),
        "seed": SEED,
        "helpful": helpful,
        "not_helpful": not_helpful,
        "unresolved": len(out) - helpful - not_helpful,
        "window_start": WINDOW_START,
        "maturity_days": MATURITY_DAYS,
    }
    (data / "sample_meta.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
