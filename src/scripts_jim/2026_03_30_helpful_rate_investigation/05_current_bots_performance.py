"""
Current bots: how are the CURRENT active bots performing?
Focus on notes submitted in March (when current config stabilized).
"""
import os
from pathlib import Path
from datetime import datetime, timedelta
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

notes = fetch_all("notes", "note_id, bot_name, submitted_at, evaluation_score")
canonical = fetch_all("canonical_note_information",
    "note_id, cn_status, locked_status, first_non_nmr_status, most_recent_non_nmr_status, "
    "view_count, rating_count, top_not_helpful_tag")
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

# Current active bots based on weight > 0
active_bots = {"opus-main", "opus-main-v2", "opus-main-no-source-check",
               "opus-direct-grok", "opus-direct", "opus-bridging",
               "opus-multi-source", "opus-main-v2-grok"}

# March notes by bot
print("=== MARCH 2026: PERFORMANCE BY BOT ===")
bot_data = defaultdict(lambda: {"h": 0, "uh": 0, "nmr": 0, "eval_scores": [], "uh_tags": []})
for n in notes:
    dt = n.get("submitted_at", "")
    if not dt.startswith("2026-03"): continue
    bot = n.get("bot_name") or "unknown"
    s = classify(n.get("note_id"))
    bot_data[bot][s] = bot_data[bot].get(s, 0) + 1
    if n.get("evaluation_score") is not None:
        bot_data[bot]["eval_scores"].append(n["evaluation_score"])
    if s == "unhelpful":
        c = canon_map.get(n.get("note_id"), {})
        bot_data[bot]["uh_tags"].append(c.get("top_not_helpful_tag") or "NULL")

print(f"{'Bot':>30} {'H':>4} {'UH':>4} {'NMR':>5} {'Tot':>5} {'H/(H+UH)':>10} {'MedEval':>8} {'Active':>7}")
for bot in sorted(bot_data.keys(), key=lambda b: -(bot_data[b].get("h", 0) + bot_data[b].get("uh", 0) + bot_data[b].get("nmr", 0))):
    d = bot_data[bot]
    h, uh, nmr = d.get("helpful", 0), d.get("unhelpful", 0), d.get("nmr", 0)
    total = h + uh + nmr
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    evals = sorted(d["eval_scores"])
    med_eval = f"{evals[len(evals)//2]:.2f}" if evals else "N/A"
    active = "YES" if bot in active_bots else "no"
    print(f"{bot:>30} {h:>4} {uh:>4} {nmr:>5} {total:>5} {ratio:>10} {med_eval:>8} {active:>7}")
    if d["uh_tags"]:
        tag_counts = defaultdict(int)
        for t in d["uh_tags"]:
            tag_counts[t] += 1
        tags_str = ", ".join(f"{t}({c})" for t, c in sorted(tag_counts.items(), key=lambda x: -x[1]))
        print(f"{'':>30}   UH tags: {tags_str}")

# Summary: aggregate by period, only counting the "opus-main lineage" bots
print("\n=== OPUS-MAIN LINEAGE vs OTHER BOTS (all time, notes table) ===")
opus_lineage = {"opus-main", "opus-main-v2", "opus-concise"}  # the proven performers

periods = [
    ("Jan 7 - Feb 9", "2026-01-07", "2026-02-10"),
    ("Feb 10 - Feb 28", "2026-02-10", "2026-03-01"),
    ("Mar 1 - Mar 30", "2026-03-01", "2026-03-31"),
]

for label, start, end in periods:
    opus_h, opus_uh, opus_nmr = 0, 0, 0
    other_h, other_uh, other_nmr = 0, 0, 0
    for n in notes:
        dt = n.get("submitted_at", "")
        if dt < start or dt >= end: continue
        bot = n.get("bot_name") or ""
        s = classify(n.get("note_id"))
        if bot in opus_lineage:
            if s == "helpful": opus_h += 1
            elif s == "unhelpful": opus_uh += 1
            else: opus_nmr += 1
        else:
            if s == "helpful": other_h += 1
            elif s == "unhelpful": other_uh += 1
            else: other_nmr += 1

    opus_total = opus_h + opus_uh + opus_nmr
    other_total = other_h + other_uh + other_nmr
    opus_ratio = f"{opus_h/(opus_h+opus_uh)*100:.0f}%" if (opus_h+opus_uh) > 0 else "N/A"
    other_ratio = f"{other_h/(other_h+other_uh)*100:.0f}%" if (other_h+other_uh) > 0 else "N/A"

    print(f"\n  {label}:")
    print(f"    Opus lineage: {opus_total} notes, {opus_h}H/{opus_uh}UH/{opus_nmr}NMR, H/(H+UH)={opus_ratio}")
    print(f"    Other bots:   {other_total} notes, {other_h}H/{other_uh}UH/{other_nmr}NMR, H/(H+UH)={other_ratio}")

# Also check: does opus-main-v2 (renamed opus-main) perform as well as old opus-main?
print("\n=== OPUS-MAIN vs OPUS-MAIN-V2 HEAD TO HEAD ===")
for bot_name in ["opus-main", "opus-main-v2"]:
    h, uh, nmr = 0, 0, 0
    for n in notes:
        if n.get("bot_name") != bot_name: continue
        s = classify(n.get("note_id"))
        if s == "helpful": h += 1
        elif s == "unhelpful": uh += 1
        else: nmr += 1
    total = h + uh + nmr
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    resolved = f"{(h+uh)/total*100:.0f}%" if total > 0 else "N/A"
    print(f"  {bot_name}: {total} notes, {h}H/{uh}UH/{nmr}NMR, H/(H+UH)={ratio}, resolved={resolved}")
