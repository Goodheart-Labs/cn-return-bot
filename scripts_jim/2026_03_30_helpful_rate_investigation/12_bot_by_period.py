"""Resolution rate of opus-main vs opus-main-v2 by period."""
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

periods = [
    ("Jan 7 – Feb 9", "2026-01-07", "2026-02-10"),
    ("Feb 10 – Feb 15", "2026-02-10", "2026-02-16"),
    ("Feb 16 – Mar 3", "2026-02-16", "2026-03-04"),
    ("Mar 4 – Mar 15", "2026-03-04", "2026-03-16"),
    ("Mar 16 – Mar 30", "2026-03-16", "2026-03-31"),
]

bots = ["opus-main", "opus-main-v2"]

for bot in bots:
    print(f"\n=== {bot} ===")
    print(f"{'Period':>22} {'H':>4} {'UH':>4} {'NMR':>5} {'Tot':>5} {'Resolved%':>10} {'H/(H+UH)':>10}")
    for label, start, end in periods:
        h = uh = nmr = 0
        for n in notes:
            if n.get("bot_name") != bot: continue
            dt = n.get("submitted_at") or ""
            if dt < start or dt >= end: continue
            s = classify(n.get("note_id"))
            if s == "helpful": h += 1
            elif s == "unhelpful": uh += 1
            else: nmr += 1
        tot = h + uh + nmr
        if tot == 0:
            print(f"{label:>22} {'—':>4} {'—':>4} {'—':>5} {0:>5}")
            continue
        res = f"{(h+uh)/tot*100:.0f}%"
        ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
        print(f"{label:>22} {h:>4} {uh:>4} {nmr:>5} {tot:>5} {res:>10} {ratio:>10}")
