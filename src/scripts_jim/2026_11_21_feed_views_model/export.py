# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "requests"]
# ///
"""Exports the feed view recorder's data (GOO-834) from prod to the devbox.

It reads one hour of feed_tweet_views per query through the management API,
which the BRIN index on observed_at serves, and writes one Parquet file per
hour to ~/dev/data/goo-834/views/. Hours already exported are skipped, and
only complete hours are read. It also writes feed_view_walks and
feed_view_posts in full each time, because both are small.

    uv run src/scripts_jim/2026_11_21_feed_views_model/export.py
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

PROJECT_REF = "ugytvkevhsmcpunfvncw"
DATA_DIR = Path.home() / "dev/data/goo-834"
TOKEN = (Path.home() / ".supabase/access-token").read_text().strip()


def query(sql: str) -> list[dict]:
    response = requests.post(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        headers={"Authorization": f"Bearer {TOKEN}", "User-Agent": "curl/8.0"},
        json={"query": sql},
        timeout=300,
    )
    response.raise_for_status()
    return response.json()


def export_hours() -> None:
    views_dir = DATA_DIR / "views"
    views_dir.mkdir(parents=True, exist_ok=True)
    first = query("select min(observed_at) as t from feed_tweet_views")[0]["t"]
    hour = datetime.fromisoformat(first).replace(minute=0, second=0, microsecond=0)
    last_complete_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    while hour < last_complete_hour:
        path = views_dir / f"{hour:%Y-%m-%dT%H}.parquet"
        if not path.exists():
            rows = query(
                "select tweet_id::text, observed_at, impressions, likes, retweets, replies, quotes, bookmarks, tier, xl_rank "
                f"from feed_tweet_views where observed_at >= '{hour.isoformat()}' and observed_at < '{(hour + timedelta(hours=1)).isoformat()}'"
            )
            pd.DataFrame(rows).to_parquet(path)
            print(f"{path.name}: {len(rows)} readings")
        hour += timedelta(hours=1)


def export_small_tables() -> None:
    walks = query("select * from feed_view_walks order by id")
    pd.DataFrame(walks).to_parquet(DATA_DIR / "walks.parquet")
    posts = query(
        "select tweet_id::text as tweet_id, posted_at, author_id, author_followers, author_tweet_count, "
        "author_verified_type, lang, referenced_type, has_video, has_photo, video_duration_ms, text from feed_view_posts"
    )
    pd.DataFrame(posts).to_parquet(DATA_DIR / "posts.parquet")
    # Until the recorder stores profiles (PR #763), the X run's feed_tweets rows
    # are the only profiles. Read their narrow columns for every recorded post,
    # never raw_tweet.
    feed_tweets = query(
        "select f.tweet_id, f.posted_at, f.author_id, f.author_followers, f.author_tweet_count, f.has_video, f.has_photo, "
        "f.video_duration_ms, f.text, f.first_seen_at, f.first_seen_impressions, f.first_seen_feed_size "
        "from feed_tweets f where f.tweet_id in (select distinct tweet_id::text from feed_tweet_views)"
    )
    pd.DataFrame(feed_tweets).to_parquet(DATA_DIR / "feed_tweets.parquet")
    print(f"walks: {len(walks)}, posts: {len(posts)}, feed_tweets profiles: {len(feed_tweets)}")

export_hours()
export_small_tables()
