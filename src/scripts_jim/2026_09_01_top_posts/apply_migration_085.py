# /// script
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Applies migrations/085_top_posts.sql to prod (GOO-81). Additive only: it
creates the everything_top_posts cache table, which stays empty and unused
until the EVERYTHING_TOP_POSTS repo variable is switched on."""

import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

repo = Path(__file__).resolve().parents[3]
load_dotenv(repo / ".env")

sql = (repo / "migrations" / "085_top_posts.sql").read_text()
conn = psycopg2.connect(os.environ["PROD_DB_URL"])
conn.autocommit = False
with conn.cursor() as cur:
    cur.execute(sql)
conn.commit()
conn.close()
print("085_top_posts.sql applied")
