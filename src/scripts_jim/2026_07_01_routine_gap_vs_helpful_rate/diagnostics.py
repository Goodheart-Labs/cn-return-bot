"""Verification checks for the routine-gap analysis (read-only)."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
load_dotenv(ROOT / ".env.local")
load_dotenv(ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

PAGE = 1000
WINDOW_START = "2026-05-01T00:00:00Z"


def fetch_paginated(table, cols, key, apply_filters, start):
    rows, last = [], start
    while True:
        q = sb.table(table).select(cols).order(key).gt(key, last).limit(PAGE)
        batch = apply_filters(q).execute().data
        if not batch:
            break
        rows.extend(batch)
        last = batch[-1][key]
        if len(batch) < PAGE:
            break
    return rows


# routine starts + elapsed
runs = json.loads((HERE / "routine_runs.json").read_text())
starts = pd.to_datetime([r["run_started_at"] for r in runs], utc=True, format="ISO8601").sort_values()
routines = pd.DataFrame({"routine_start": starts}).reset_index(drop=True)
routines["elapsed_min"] = routines["routine_start"].diff().dt.total_seconds() / 60.0

print("=== elapsed_min distribution (gap between routine starts) ===")
e = routines["elapsed_min"].dropna()
for p in [0, 5, 25, 50, 75, 90, 95, 99, 100]:
    print(f"  p{p:>3}: {np.percentile(e, p):8.1f} min")
print(f"  mean: {e.mean():.1f}  std: {e.std():.1f}  n={len(e)}")

# notes + feed
sruns = fetch_paginated("pipeline_runs", "id, note_id, ab_test_picks, created_at", "id",
                        lambda q: q.eq("outcome", "submitted").gte("created_at", WINDOW_START),
                        "00000000-0000-0000-0000-000000000000")
sruns = [r for r in sruns if r.get("note_id")]
feed = pd.DataFrame({
    "note_id": [r["note_id"] for r in sruns],
    "feed_size": [(r.get("ab_test_picks") or {}).get("feed_size") for r in sruns],
    "run_created_at": [r["created_at"] for r in sruns],
}).drop_duplicates("note_id")
notes = pd.DataFrame(fetch_paginated("notes", "note_id, submitted_at, cn_status", "note_id",
                                     lambda q: q.gte("submitted_at", WINDOW_START), ""))
notes["submitted_at"] = pd.to_datetime(notes["submitted_at"], utc=True, format="ISO8601")
df = notes.merge(feed, on="note_id", how="inner")

print("\n=== missing feed_size by month ===")
df["month"] = df["submitted_at"].dt.strftime("%Y-%m")
df["feed_missing"] = df["feed_size"].isna()
print(df.groupby("month")["feed_missing"].agg(["sum", "count"]).to_string())
print("\n=== feed_size present, by month ===")
print(pd.crosstab(df["month"], df["feed_size"].fillna("(missing)")).to_string())

# spot-check binning: 5 random notes -> assigned routine window brackets submitted_at?
print("\n=== spot-check binning (submitted_at must fall in [start_i, start_{i+1})) ===")
starts_ns = routines["routine_start"].values.astype("datetime64[ns]")
sample = df.dropna(subset=["submitted_at"]).sample(6, random_state=7)
for _, r in sample.iterrows():
    sub = np.datetime64(r["submitted_at"].tz_convert(None))
    i = np.searchsorted(starts_ns, sub, side="right") - 1
    lo = routines["routine_start"].iloc[i] if i >= 0 else None
    hi = routines["routine_start"].iloc[i + 1] if i + 1 < len(routines) else None
    ok = (lo is not None and lo <= r["submitted_at"]) and (hi is None or r["submitted_at"] < hi)
    print(f"  note {r['note_id']} sub={r['submitted_at']} feed={r['feed_size']} "
          f"status={r['cn_status']} -> routine[{i}] [{lo} .. {hi}) ok={ok}")

# freshness cross-check vs public_data_snapshots (latest snapshot per note)
print("\n=== freshness cross-check: notes.cn_status vs latest public_data_snapshots.current_status ===")
helpful_ids = df[df["cn_status"] == "CURRENTLY_RATED_HELPFUL"]["note_id"].head(3).tolist()
nmr_ids = df[df["cn_status"] == "NEEDS_MORE_RATINGS"]["note_id"].head(3).tolist()
for nid in helpful_ids + nmr_ids:
    snaps = sb.table("public_data_snapshots").select("current_status, snapshot_date") \
        .eq("note_id", nid).order("snapshot_date", desc=True).limit(1).execute().data
    cn = df[df["note_id"] == nid]["cn_status"].iloc[0]
    snap = snaps[0] if snaps else None
    print(f"  note {nid}: notes.cn_status={cn}  | snapshot={snap}")
