"""
Deep dive: check bot_name, evaluation scores, not-helpful tags, volume by bot,
and whether the "unknown" statuses in recent weeks are just unrated.
"""
import os, json
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict
from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

def fetch_all(table, select, filters=None):
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        q = sb.table(table).select(select)
        if filters:
            for col, op, val in filters:
                q = q.filter(col, op, val)
        resp = q.range(offset, offset + page_size - 1).execute()
        all_rows.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size
    return all_rows

# 1. Notes table - has bot_name and submitted_at
print("Fetching notes table...")
notes = fetch_all("notes", "note_id, bot_name, submitted_at, evaluation_score, cn_status, view_count, notewriter_id")
print(f"  {len(notes)} notes")

# 2. Pipeline runs - outcomes over time
print("Fetching pipeline_runs...")
runs = fetch_all("pipeline_runs", "id, bot_id, outcome, outcome_reason, final_stage, created_at, note_id, tweet_id")
print(f"  {len(runs)} runs")

# 3. Pipeline scores
print("Fetching pipeline_scores...")
scores = fetch_all("pipeline_scores", "pipeline_run_id, score_type, score_value, score_label")
print(f"  {len(scores)} scores")

# 4. Bot configs
print("Fetching bot_configs...")
configs = fetch_all("bot_configs", "id, name, is_active, created_at")
print(f"  {len(configs)} configs")
for c in configs:
    print(f"    {c['id']}: {c['name']} (active={c['is_active']}, created={c['created_at'][:10]})")

# 5. Canonical with more detail
print("Fetching canonical_note_information...")
canonical = fetch_all("canonical_note_information",
    "note_id, first_seen_at, cn_status, locked_status, first_non_nmr_status, "
    "most_recent_non_nmr_status, top_not_helpful_tag, top_helpful_tag, view_count, data_tier")

# Map note_id -> canonical
canon_map = {n["note_id"]: n for n in canonical}

# === ANALYSIS ===

def week_of(dt_str):
    if not dt_str: return None
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    return (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")

# A) Notes by bot_name over time, with helpful/unhelpful
print("\n=== NOTES BY BOT & WEEK (from notes table) ===")
bot_week = defaultdict(lambda: defaultdict(lambda: {"total": 0, "helpful": 0, "unhelpful": 0, "nmr": 0}))
for n in notes:
    w = week_of(n.get("submitted_at"))
    if not w: continue
    bot = n.get("bot_name") or "unknown"
    bot_week[bot][w]["total"] += 1
    # Use canonical status if available
    c = canon_map.get(n.get("note_id"), {})
    status = (c.get("locked_status") or c.get("most_recent_non_nmr_status") or
              c.get("first_non_nmr_status") or c.get("cn_status") or "")
    if "helpful" in status.lower() and "not" not in status.lower():
        bot_week[bot][w]["helpful"] += 1
    elif "not_helpful" in status.lower():
        bot_week[bot][w]["unhelpful"] += 1
    else:
        bot_week[bot][w]["nmr"] += 1

for bot in sorted(bot_week.keys()):
    print(f"\n  Bot: {bot}")
    print(f"  {'Week':>12} {'Total':>6} {'H':>4} {'UH':>4} {'NMR':>5} {'H/(H+UH)':>10}")
    for w in sorted(bot_week[bot].keys()):
        d = bot_week[bot][w]
        ratio = f"{d['helpful']/(d['helpful']+d['unhelpful'])*100:.0f}%" if (d['helpful']+d['unhelpful']) > 0 else "N/A"
        print(f"  {w:>12} {d['total']:>6} {d['helpful']:>4} {d['unhelpful']:>4} {d['nmr']:>5} {ratio:>10}")

# B) Evaluation scores over time
print("\n=== EVALUATION SCORES BY WEEK ===")
eval_week = defaultdict(list)
for n in notes:
    w = week_of(n.get("submitted_at"))
    if not w: continue
    score = n.get("evaluation_score")
    if score is not None:
        eval_week[w].append(score)

print(f"{'Week':>12} {'Count':>6} {'Mean':>8} {'Median':>8} {'Min':>6} {'Max':>6}")
for w in sorted(eval_week.keys()):
    vals = sorted(eval_week[w])
    mean = sum(vals)/len(vals)
    median = vals[len(vals)//2]
    print(f"{w:>12} {len(vals):>6} {mean:>8.2f} {median:>8.2f} {min(vals):>6.2f} {max(vals):>6.2f}")

# C) Not-helpful tags over time (weekly)
print("\n=== NOT-HELPFUL TAGS BY PERIOD (pre vs post Feb 15) ===")
pre_tags = defaultdict(int)
post_tags = defaultdict(int)
for n in notes:
    w = week_of(n.get("submitted_at"))
    if not w: continue
    c = canon_map.get(n.get("note_id"), {})
    status = (c.get("locked_status") or c.get("most_recent_non_nmr_status") or
              c.get("first_non_nmr_status") or c.get("cn_status") or "")
    if "not_helpful" in status.lower():
        tag = c.get("top_not_helpful_tag") or "NULL"
        if w < "2026-02-16":
            pre_tags[tag] += 1
        else:
            post_tags[tag] += 1

print("  PRE Feb 16:")
for t, c in sorted(pre_tags.items(), key=lambda x: -x[1]):
    print(f"    {t}: {c}")
print("  POST Feb 16:")
for t, c in sorted(post_tags.items(), key=lambda x: -x[1]):
    print(f"    {t}: {c}")

# D) Pipeline outcomes over time
print("\n=== PIPELINE OUTCOMES BY WEEK ===")
outcome_week = defaultdict(lambda: defaultdict(int))
for r in runs:
    w = week_of(r.get("created_at"))
    if not w: continue
    outcome_week[w][r.get("outcome") or "NULL"] += 1

print(f"{'Week':>12} {'submit':>7} {'filter':>7} {'fail':>5} {'reject':>7} {'cand':>5} {'other':>6}")
for w in sorted(outcome_week.keys()):
    d = outcome_week[w]
    print(f"{w:>12} {d.get('submitted',0):>7} {d.get('filtered',0):>7} {d.get('failed',0):>5} "
          f"{d.get('rejected',0):>7} {d.get('candidate',0):>5} {sum(v for k,v in d.items() if k not in ('submitted','filtered','failed','rejected','candidate')):>6}")

# E) Filter/rejection reasons over time
print("\n=== TOP OUTCOME REASONS PRE vs POST Feb 16 ===")
pre_reasons = defaultdict(int)
post_reasons = defaultdict(int)
for r in runs:
    w = week_of(r.get("created_at"))
    if not w: continue
    reason = r.get("outcome_reason") or "NULL"
    if r.get("outcome") in ("filtered", "rejected"):
        if w < "2026-02-16":
            pre_reasons[reason] += 1
        else:
            post_reasons[reason] += 1

print("  PRE Feb 16 (top 15):")
for t, c in sorted(pre_reasons.items(), key=lambda x: -x[1])[:15]:
    print(f"    {t}: {c}")
print("  POST Feb 16 (top 15):")
for t, c in sorted(post_reasons.items(), key=lambda x: -x[1])[:15]:
    print(f"    {t}: {c}")

# F) Score types and distributions
print("\n=== SCORE TYPES ===")
score_types = defaultdict(int)
for s in scores:
    score_types[s.get("score_type") or "NULL"] += 1
for t, c in sorted(score_types.items(), key=lambda x: -x[1]):
    print(f"  {t}: {c}")

# G) Check scores for submitted notes pre vs post
print("\n=== EVALUATION SCORES FOR SUBMITTED NOTES: PRE vs POST Feb 16 ===")
run_map = {r["id"]: r for r in runs}
pre_eval = []
post_eval = []
for s in scores:
    if s.get("score_type") != "evaluation": continue
    run = run_map.get(s.get("pipeline_run_id"))
    if not run or run.get("outcome") != "submitted": continue
    w = week_of(run.get("created_at"))
    if not w: continue
    val = s.get("score_value")
    if val is None: continue
    if w < "2026-02-16":
        pre_eval.append(val)
    else:
        post_eval.append(val)

if pre_eval:
    print(f"  PRE:  n={len(pre_eval)}, mean={sum(pre_eval)/len(pre_eval):.2f}, median={sorted(pre_eval)[len(pre_eval)//2]:.2f}")
if post_eval:
    print(f"  POST: n={len(post_eval)}, mean={sum(post_eval)/len(post_eval):.2f}, median={sorted(post_eval)[len(post_eval)//2]:.2f}")
