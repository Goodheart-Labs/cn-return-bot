"""Download what the first check of each tweet logged that the filter backtest needs (GOO-835).

Per tweet, from its first `pipeline_runs` row: the existing note-needed
prefilter's verdict and cost, the cascading search's cheap probability, and
Gemini's descriptions of the tweet's images and videos. The media descriptions
are what the new filter reads instead of the images themselves. We do not send
images to Anthropic, because Nathan's Claude account was banned once over
images in tweets.

Run from the worktree root:
  python3 src/scripts_jim/2026_11_20_tweet_note_prefilter/fetch_run_extras.py
"""

import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from prod_sql import query  # noqa: E402

OUT_PATH = Path("/home/jim/dev/data/goo-835/run_extras.jsonl")
START_DAY = dt.date(2026, 9, 15)
END_DAY = dt.date(2026, 11, 21)
MAX_TRANSCRIPT_CHARS = 1500

SQL = """
select distinct on (tweet_id) tweet_id,
  logs->'note_prefilter_steps'->'verdict'->>'needsNote' as prefilter_needs_note,
  (logs->'costs'->'groups'->'note_prefilter'->>'cost')::float as prefilter_cost,
  (logs->'costs'->'total'->>'cost')::float as total_cost,
  logs->'cascade'->>'decision' as cascade_decision,
  (logs->'cascade'->>'probability')::float as cascade_probability,
  (logs->'inputs'->'author'->'noteHistory'->>'totalHelpful')::int as author_history_helpful,
  (logs->'inputs'->'author'->'noteHistory'->>'totalUnhelpful')::int as author_history_unhelpful,
  (select jsonb_agg(jsonb_build_object('type', m->>'type', 'description', m->'description'->>'description',
      'ocr', m->'description'->>'ocrText', 'transcript', left(m->>'transcription', {transcript_chars})))
   from jsonb_array_elements(coalesce(logs->'media'->'gemini'->'tweetMedia', '[]'::jsonb)) m) as tweet_media,
  (select jsonb_agg(jsonb_build_object('type', m->>'type', 'description', m->'description'->>'description',
      'ocr', m->'description'->>'ocrText', 'transcript', left(m->>'transcription', {transcript_chars})))
   from jsonb_array_elements(coalesce(logs->'media'->'gemini'->'quotedTweetMedia', '[]'::jsonb)) m) as quoted_media
from pipeline_runs
where created_at >= '{day}'::date and created_at < '{day}'::date + 1 and tweet_id is not null
order by tweet_id, created_at
"""


def main() -> None:
    day = START_DAY
    with OUT_PATH.open("w") as out:
        while day < END_DAY:
            rows = query(SQL.format(day=day.isoformat(), transcript_chars=MAX_TRANSCRIPT_CHARS))
            for row in rows:
                out.write(json.dumps(row, default=str) + "\n")
            print(day, len(rows), flush=True)
            day += dt.timedelta(days=1)


main()
