# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv", "pandas", "pyarrow"]
# ///
"""ONE read-only pull for the score types the sibling pull missed.

The sibling `../2026_09_18_outcome_screen/pull.py` selected `pipeline_scores` with
`score_type = 'evaluation'` only, so the materiality judge's per-note verdicts are not
on disk. This fetches them for exactly the pipeline_run_ids already in the local data
and writes them to THIS folder's data/. It touches nothing else and modifies no
sibling folder.

Gentle on the 1 GB prod instance: read-only transaction, 60 s statement timeout, three
narrow columns, id-list lookups through the pipeline_run_id index in chunks of 500,
a short sleep between chunks, one pass.

Run:  uv run pull_materiality.py       (refuses to overwrite; pass --force)
"""
import os
import sys
import time
from pathlib import Path

import pandas as pd
import psycopg2
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
SCREEN_DATA = HERE.parent / "2026_09_18_outcome_screen" / "data"
ENV_FILE = "/Users/natha/Documents/Source/cn-return-bot/.env"
CHUNK = 500
SCORE_TYPES = ["materiality_overall", "materiality_engages", "materiality_convince",
               "materiality_takeaway", "source_verification"]


def main():
    out = DATA / "materiality_scores.parquet"
    if out.exists() and "--force" not in sys.argv:
        sys.exit(f"{out} exists; this pull is one-time. Pass --force to redo it.")
    DATA.mkdir(exist_ok=True)

    runs = pd.read_parquet(SCREEN_DATA / "pipeline_runs.parquet")
    ids = sorted(runs["run_id"].dropna().unique())
    print(f"pipeline_run_ids to look up: {len(ids)}")

    load_dotenv(ENV_FILE)
    conn = psycopg2.connect(
        host="aws-1-eu-west-1.pooler.supabase.com", port=5432,
        user="postgres.ugytvkevhsmcpunfvncw", password=os.environ["SUPABASE_DB_PASSWORD"],
        dbname="postgres", connect_timeout=15,
        options="-c default_transaction_read_only=on -c statement_timeout=60000",
    )
    cur = conn.cursor()
    cur.execute("select now()")
    pulled_at = cur.fetchone()[0]

    sql = """select pipeline_run_id::text as run_id, score_type, score_value
             from pipeline_scores
             where pipeline_run_id = any(%s::uuid[]) and score_type = any(%s)"""
    frames = []
    for i in range(0, len(ids), CHUNK):
        cur.execute(sql, (ids[i:i + CHUNK], SCORE_TYPES))
        cols = [d[0] for d in cur.description]
        frames.append(pd.DataFrame(cur.fetchall(), columns=cols))
        time.sleep(0.3)
    conn.close()

    sc = pd.concat(frames, ignore_index=True)
    sc["score_value"] = sc["score_value"].astype(float)
    sc.to_parquet(out)
    print(f"rows: {len(sc)}  pulled_at: {pulled_at}")
    print(sc.groupby("score_type")["score_value"].agg(
        ["size", "nunique", "min", "max", "mean", "std"]).to_string())
    (DATA / "materiality_pull_meta.json").write_text(
        pd.Series({"pulled_at_utc": str(pulled_at), "n_run_ids_looked_up": len(ids),
                   "n_rows": len(sc), "score_types": ",".join(SCORE_TYPES)}).to_json(indent=2))


if __name__ == "__main__":
    main()
