"""Probe pipeline_runs: counts per bot, date range, and one sample logs tree."""
import os
import json
from pathlib import Path
from collections import Counter
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).resolve().parents[3] / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

for bot in ("cheap-bot", "simple-bot"):
    # total count
    r = sb.table("pipeline_runs").select("id", count="exact").eq("bot_name", bot).limit(1).execute()
    print(f"\n=== {bot}: total runs = {r.count} ===")
    # date range + outcome breakdown on a recent sample
    rows = (
        sb.table("pipeline_runs")
        .select("created_at, outcome, outcome_reason, final_stage, note_status, check_reasoning")
        .eq("bot_name", bot)
        .order("created_at", desc=True)
        .limit(2000)
        .execute()
    ).data
    if rows:
        print("newest:", rows[0]["created_at"], "oldest(of 2000):", rows[-1]["created_at"])
        print("outcome:", dict(Counter(x["outcome"] for x in rows)))
        print("outcome_reason:", dict(Counter(x["outcome_reason"] for x in rows)))
        print("final_stage:", dict(Counter(x["final_stage"] for x in rows)))
        print("check_reasoning(truthy/none):", dict(Counter("set" if x["check_reasoning"] else "none" for x in rows)))

# sample logs tree for cheap-bot (a candidate/submitted run, and a no_correction run)
print("\n=== sample cheap-bot logs.note_writer_steps keys ===")
for reason in (None, "no_correction_needed"):
    q = sb.table("pipeline_runs").select("outcome, outcome_reason, logs").eq("bot_name", "cheap-bot")
    if reason:
        q = q.eq("outcome_reason", reason)
    else:
        q = q.eq("outcome", "submitted")
    s = q.order("created_at", desc=True).limit(1).execute().data
    if s:
        logs = s[0].get("logs") or {}
        nws = (logs.get("note_writer_steps") or {})
        print(f"\n[{s[0]['outcome']}/{s[0]['outcome_reason']}] note_writer_steps top keys:", list(nws.keys()))
        sat = nws.get("satire_detector")
        print("  satire_detector:", json.dumps(sat)[:200] if sat else None)
        jn = nws.get("note_needed_judge")
        if jn:
            print("  note_needed_judge keys:", list(jn.keys()), "| msg1.content:", json.dumps(jn.get("messages", {}).get("1", {}))[:200])
        print("  skipReason:", nws.get("skipReason"))
