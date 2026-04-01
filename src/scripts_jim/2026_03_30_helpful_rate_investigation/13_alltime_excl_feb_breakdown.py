"""All-time bot performance excluding Feb 16 – Mar 8 (broken citations era)."""
import os
from pathlib import Path
from collections import defaultdict
from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

def fetch_all(table, select):
    rows, offset = [], 0
    while True:
        resp = sb.table(table).select(select).range(offset, offset + 999).execute()
        rows.extend(resp.data)
        if len(resp.data) < 1000: break
        offset += 1000
    return rows

notes = fetch_all("notes", "note_id, bot_name, submitted_at")
canonical = fetch_all("canonical_note_information",
    "note_id, cn_status, locked_status, first_non_nmr_status, most_recent_non_nmr_status")
canon_map = {n["note_id"]: n for n in canonical}

def classify(note_id):
    c = canon_map.get(note_id, {})
    s = (c.get("locked_status") or c.get("most_recent_non_nmr_status") or
         c.get("first_non_nmr_status") or c.get("cn_status") or "")
    if "helpful" in s.lower() and "not" not in s.lower():
        return "helpful"
    elif "not_helpful" in s.lower():
        return "unhelpful"
    return "nmr"

EXCLUDE_START = "2026-02-23"
EXCLUDE_END = "2026-03-16"

bot_data = defaultdict(lambda: {"h": 0, "uh": 0, "nmr": 0})
for n in notes:
    dt = n.get("submitted_at") or ""
    if EXCLUDE_START <= dt < EXCLUDE_END:
        continue
    bot = n.get("bot_name") or "unknown"
    s = classify(n.get("note_id"))
    if s == "helpful": bot_data[bot]["h"] += 1
    elif s == "unhelpful": bot_data[bot]["uh"] += 1
    else: bot_data[bot]["nmr"] += 1

print(f"All time, excluding {EXCLUDE_START} to {EXCLUDE_END}\n")
for bot in sorted(bot_data.keys(), key=lambda b: -(bot_data[b]["h"] + bot_data[b]["uh"] + bot_data[b]["nmr"])):
    d = bot_data[bot]
    h, uh, nmr = d["h"], d["uh"], d["nmr"]
    tot = h + uh + nmr
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    res = f"{(h+uh)/tot*100:.0f}%" if tot > 0 else "N/A"
    print(f"{bot:>30} {h:>4} {uh:>4} {nmr:>5} {tot:>5} {ratio:>10} {res:>10}")

th = sum(d["h"] for d in bot_data.values())
tuh = sum(d["uh"] for d in bot_data.values())
tnmr = sum(d["nmr"] for d in bot_data.values())
ttot = th + tuh + tnmr
tratio = f"{th/(th+tuh)*100:.0f}%" if (th+tuh) > 0 else "N/A"
tres = f"{(th+tuh)/ttot*100:.0f}%" if ttot > 0 else "N/A"
print(f"{'TOTAL':>30} {th:>4} {tuh:>4} {tnmr:>5} {ttot:>5} {tratio:>10} {tres:>10}")
