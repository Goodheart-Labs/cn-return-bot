"""Download what is needed to show Claude Code a test tweet as the X run saw it (GOO-835).

The Claude filter (claude_filter.ts) gives Haiku the Claude note writer's
input for each tweet. This script draws its sample and fetches the parts of
that input:
- the post from the `tweets` table, whose numbers are those of the moment the
  X run first saw it,
- from the tweet's first `pipeline_runs` row, Gemini's descriptions of its
  images and videos, the author's note history as the run had it (so it holds
  no later notes), and the time of the run.

The sample comes only from tweets that drew simple-bot. Only their rows log
the image descriptions, and the bot is drawn at random, so they are a fair
sample of what the X run checks. A claude-code row has the image links
instead, and Haiku must never see an image. Tweets whose text is in the
examples of Claude's system prompt are left out.

The positives are oversampled, so that the recall is measured on enough of
them. claude_filter_report.py weights the negatives back to their real share.

Run from the worktree root:
  uv run --with pandas --with pyarrow src/scripts_jim/2026_11_20_tweet_note_prefilter/fetch_claude_inputs.py
"""

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from prod_sql import query  # noqa: E402

DATA_DIR = Path("/home/jim/dev/data/goo-835")
OUT_PATH = DATA_DIR / "claude_inputs.jsonl"
EXAMPLES_PATH = Path(__file__).parents[3] / "docs/x-note-examples.md"
SAMPLE_BOT = "simple-bot"
POSITIVES = 100
NEGATIVES = 200
SEED = 0
EXAMPLE_TEXT_PREFIX_CHARS = 60
RUN_IDS_PER_QUERY = 100

SQL = """
select r.id as run_id, r.created_at, r.logs->'media'->'gemini' as media,
  r.logs->'inputs'->'author'->'noteHistory' as note_history,
  jsonb_build_object('id', t.tweet_id, 'text', t.text, 'author_id', t.author_id, 'author_name', t.author_name,
    'author_followers', t.author_followers, 'author_description', t.author_description,
    'author_tweet_count', t.author_tweet_count, 'created_at', t.posted_at,
    'public_metrics', jsonb_build_object('impression_count', t.impressions, 'like_count', t.likes,
      'retweet_count', t.retweets, 'reply_count', t.replies, 'quote_count', t.quotes),
    'referenced_tweets', t.referenced_tweets, 'referenced_tweet_data', t.referenced_tweet_data) as post
from pipeline_runs r join tweets t on t.tweet_id = r.tweet_id
where r.id in ({ids})
"""


def in_examples(text: str, examples: str) -> bool:
    return text.strip()[:EXAMPLE_TEXT_PREFIX_CHARS] in examples


def sql_ids(run_ids: list[str]) -> str:
    return ", ".join(f"'{run_id}'" for run_id in run_ids)


def draw_sample(df: pd.DataFrame) -> pd.DataFrame:
    examples = EXAMPLES_PATH.read_text()
    media_described = df["tweet_media"].apply(lambda media: media is not None and len(media) > 0)
    pool = df[(df["split"] == "test") & (df["bot"] == SAMPLE_BOT) & (media_described | ~(df["has_photo"] | df["has_video"]))]
    pool = pool[~pool["text"].fillna("").apply(lambda text: in_examples(text, examples))]
    positives = pool[pool["helpful"]].sample(POSITIVES, random_state=SEED)
    negatives = pool[~pool["helpful"]].sample(NEGATIVES, random_state=SEED)
    print(f"{len(pool)} simple-bot test tweets, positive share {pool['helpful'].mean():.3f}")
    return pd.concat([positives, negatives])


def main() -> None:
    df = pd.read_parquet(DATA_DIR / "dataset.parquet")
    sample = draw_sample(df)
    run_ids = sample["run_id"].tolist()
    rows = []
    for start in range(0, len(run_ids), RUN_IDS_PER_QUERY):
        rows += query(SQL.format(ids=sql_ids(run_ids[start:start + RUN_IDS_PER_QUERY])))
    by_run = {row["run_id"]: row for row in rows}
    with open(OUT_PATH, "w") as out:
        for tweet in sample.itertuples():
            row = by_run[tweet.run_id]
            out.write(json.dumps({"tweet_id": tweet.tweet_id, "helpful": bool(tweet.helpful), **row}) + "\n")
    print(f"wrote {len(sample)} tweets to {OUT_PATH}")


if __name__ == "__main__":
    main()
