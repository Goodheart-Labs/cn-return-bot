"""Detailed March 2026 performance by bot."""
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

notes = fetch_all("notes", "note_id, bot_name, submitted_at, evaluation_score")
canonical = fetch_all("canonical_note_information",
    "note_id, cn_status, locked_status, first_non_nmr_status, most_recent_non_nmr_status, "
    "view_count, rating_count, top_not_helpful_tag, top_helpful_tag")
canon_map = {n["note_id"]: n for n in canonical}

active_bots = {"opus-main", "opus-main-v2", "opus-main-no-source-check",
               "opus-direct-grok", "opus-direct", "opus-bridging",
               "opus-multi-source", "opus-main-v2-grok"}

def classify(note_id):
    c = canon_map.get(note_id, {})
    s = (c.get("locked_status") or c.get("most_recent_non_nmr_status") or
         c.get("first_non_nmr_status") or c.get("cn_status") or "")
    if "helpful" in s.lower() and "not" not in s.lower():
        return "helpful"
    elif "not_helpful" in s.lower():
        return "unhelpful"
    return "nmr"

bot_data = defaultdict(lambda: {
    "helpful": 0, "unhelpful": 0, "nmr": 0,
    "eval_scores": [], "views": [], "ratings": [],
    "uh_tags": [], "h_tags": []
})

for n in notes:
    dt = n.get("submitted_at", "")
    if not dt.startswith("2026-03"): continue
    bot = n.get("bot_name") or "unknown"
    s = classify(n.get("note_id"))
    bot_data[bot][s] += 1
    if n.get("evaluation_score") is not None:
        bot_data[bot]["eval_scores"].append(n["evaluation_score"])
    c = canon_map.get(n.get("note_id"), {})
    if c.get("view_count") is not None:
        bot_data[bot]["views"].append(c["view_count"])
    if c.get("rating_count") is not None:
        bot_data[bot]["ratings"].append(c["rating_count"])
    if s == "unhelpful":
        bot_data[bot]["uh_tags"].append(c.get("top_not_helpful_tag") or "NULL")
    if s == "helpful":
        bot_data[bot]["h_tags"].append(c.get("top_helpful_tag") or "NULL")

print("=== MARCH 2026: DETAILED PERFORMANCE BY BOT ===\n")
header = (f"{'Bot':>30} {'H':>4} {'UH':>4} {'NMR':>5} {'Tot':>5} "
          f"{'H/(H+UH)':>9} {'Resolved%':>10} {'MedEval':>8} "
          f"{'MedViews':>10} {'MedRatings':>11} {'Weight':>7}")
print(header)
print("-" * len(header))

weights = {
    "opus-main": 40, "opus-main-v2": 20, "opus-main-no-source-check": 10,
    "opus-direct-grok": 7, "opus-direct": 7, "opus-bridging": 7,
    "opus-multi-source": 7, "opus-main-v2-grok": 6
}

for bot in sorted(bot_data.keys(), key=lambda b: -(bot_data[b]["helpful"] + bot_data[b]["unhelpful"] + bot_data[b]["nmr"])):
    d = bot_data[bot]
    h, uh, nmr = d["helpful"], d["unhelpful"], d["nmr"]
    total = h + uh + nmr
    ratio = f"{h/(h+uh)*100:.0f}%" if (h+uh) > 0 else "N/A"
    resolved = f"{(h+uh)/total*100:.0f}%" if total > 0 else "N/A"
    evals = sorted(d["eval_scores"])
    med_eval = f"{evals[len(evals)//2]:.2f}" if evals else "N/A"
    views = sorted(d["views"])
    med_views = f"{views[len(views)//2]:,.0f}" if views else "N/A"
    ratings = sorted(d["ratings"])
    med_ratings = f"{ratings[len(ratings)//2]:,.0f}" if ratings else "N/A"
    w = weights.get(bot, 0)
    w_str = f"{w}%" if w else "0%"
    print(f"{bot:>30} {h:>4} {uh:>4} {nmr:>5} {total:>5} "
          f"{ratio:>9} {resolved:>10} {med_eval:>8} "
          f"{med_views:>10} {med_ratings:>11} {w_str:>7}")

print(f"\n{'TOTAL':>30} ", end="")
th = sum(d["helpful"] for d in bot_data.values())
tuh = sum(d["unhelpful"] for d in bot_data.values())
tnmr = sum(d["nmr"] for d in bot_data.values())
ttot = th + tuh + tnmr
tratio = f"{th/(th+tuh)*100:.0f}%" if (th+tuh) > 0 else "N/A"
tresolved = f"{(th+tuh)/ttot*100:.0f}%" if ttot > 0 else "N/A"
print(f"{th:>3} {tuh:>4} {tnmr:>5} {ttot:>5} {tratio:>9} {tresolved:>10}")

# Unhelpful tag breakdown
print("\n=== UNHELPFUL TAG BREAKDOWN (March) ===")
all_uh_tags = defaultdict(lambda: defaultdict(int))
for bot, d in bot_data.items():
    for t in d["uh_tags"]:
        all_uh_tags[bot][t] += 1

for bot in sorted(all_uh_tags.keys()):
    tags = all_uh_tags[bot]
    tags_str = ", ".join(f"{t}: {c}" for t, c in sorted(tags.items(), key=lambda x: -x[1]))
    print(f"  {bot}: {tags_str}")

# Helpful tag breakdown
print("\n=== HELPFUL TAG BREAKDOWN (March) ===")
all_h_tags = defaultdict(lambda: defaultdict(int))
for bot, d in bot_data.items():
    for t in d["h_tags"]:
        all_h_tags[bot][t] += 1

for bot in sorted(all_h_tags.keys()):
    tags = all_h_tags[bot]
    tags_str = ", ".join(f"{t}: {c}" for t, c in sorted(tags.items(), key=lambda x: -x[1]))
    print(f"  {bot}: {tags_str}")
