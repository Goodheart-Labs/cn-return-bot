# /// script
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""One-time prod fixup for GOO-81. The first draft of migration 085 was
already applied; the final version moves the refresh stamp from the cache
rows to the followed feed. This script applies exactly that delta, and drops
the cache rows of a visited-only creator that the first fill test wrote,
because the final design gives top posts to followed feeds only."""

import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

conn = psycopg2.connect(os.environ["PROD_DB_URL"])
with conn.cursor() as cur:
    cur.execute("alter table everything_top_posts drop column refreshed_at")
    cur.execute("alter table everything_followed_feeds add column top_posts_refreshed_at timestamptz")
    cur.execute(
        "comment on column everything_followed_feeds.top_posts_refreshed_at is "
        "'When this creator''s everything_top_posts rows were last recomputed. Null means never.'"
    )
    cur.execute("delete from everything_top_posts where feed_url = 'https://nathanpmyoung.substack.com'")
    print(f"deleted {cur.rowcount} visited-only cache rows")
conn.commit()
conn.close()
print("fixup applied")
