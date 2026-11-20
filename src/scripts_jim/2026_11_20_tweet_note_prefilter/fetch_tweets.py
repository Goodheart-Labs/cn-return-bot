"""Download every tweet the X run checked since 2026-09-15, with its check (GOO-835).

One row per tweet: the tweet as the `tweets` table stores it, plus the first
`pipeline_runs` row for it. That row tells which bot drew it, how the check
ended, and the ranking features the run froze at fetch time (velocity, age,
feed tier). The engagement numbers on `tweets` are the latest the X run saw,
which for most tweets is the value at first sight, because a tweet is checked
once.

Run from the worktree root:
  python3 src/scripts_jim/2026_11_20_tweet_note_prefilter/fetch_tweets.py
"""

import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from prod_sql import query  # noqa: E402

OUT_PATH = Path("/home/jim/dev/data/goo-835/tweets.jsonl")
START_DAY = dt.date(2026, 9, 15)
END_DAY = dt.date(2026, 11, 21)

SQL = """
with first_run as (
  select distinct on (tweet_id) tweet_id, id as run_id, created_at as run_at,
    coalesce(ab_test_picks->>'bot', bot_name) as bot, outcome, outcome_reason, final_stage, note_id, note_text, cost,
    ab_test_picks->>'feed_size' as feed_size, ab_test_picks->>'misinfo_monitoring' as misinfo_monitoring,
    logs->'ranking'->'features' as ranking_features
  from pipeline_runs
  where created_at >= '{day}'::date and created_at < '{day}'::date + 2 and tweet_id is not null
  order by tweet_id, created_at
)
select t.tweet_id, t.author_id, t.author_handle, t.author_name, t.author_description, t.author_followers,
  t.text, t.posted_at, t.first_seen_at, t.impressions, t.likes, t.retweets, t.replies, t.quotes, t.bookmarks,
  t.has_video, t.has_photo, t.media_count, t.video_duration_ms, t.referenced_tweets, t.referenced_tweet_data,
  t.raw_tweet->>'lang' as lang, r.*
from tweets t left join first_run r using (tweet_id)
where t.first_seen_at >= '{day}'::date and t.first_seen_at < '{day}'::date + 1
"""


def main() -> None:
    day = START_DAY
    with OUT_PATH.open("w") as out:
        while day < END_DAY:
            rows = query(SQL.format(day=day.isoformat()))
            for row in rows:
                out.write(json.dumps(row, default=str) + "\n")
            print(day, len(rows), flush=True)
            day += dt.timedelta(days=1)


main()
