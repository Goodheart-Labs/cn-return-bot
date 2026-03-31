"""
Check if post-Feb 15 notes target lower-engagement tweets.
Also check resolved rate by bot - are new bot notes just never getting rated?
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

# Pipeline runs for submitted notes - has tweet engagement data
print("Fetching submitted pipeline runs...")
runs = fetch_all("pipeline_runs",
    "id, bot_id, note_id, tweet_id, created_at, tweet_impressions, tweet_likes, "
    "tweet_retweets, tweet_replies, author_followers, outcome")
submitted = [r for r in runs if r.get("outcome") == "submitted"]
print(f"  {len(submitted)} submitted runs")

# Bot configs for name mapping
configs = fetch_all("bot_configs", "id, name")
config_map = {c["id"]: c["name"] for c in configs}

# Canonical for status
canonical = fetch_all("canonical_note_information",
    "note_id, cn_status, locked_status, first_non_nmr_status, most_recent_non_nmr_status, view_count, rating_count")
canon_map = {n["note_id"]: n for n in canonical}

def status_of(note_id):
    c = canon_map.get(note_id, {})
    s = (c.get("locked_status") or c.get("most_recent_non_nmr_status") or
         c.get("first_non_nmr_status") or c.get("cn_status") or "")
    if "helpful" in s.lower() and "not" not in s.lower():
        return "helpful"
    elif "not_helpful" in s.lower():
        return "unhelpful"
    return "nmr"

# 1. Tweet engagement for submitted notes: pre vs post
print("\n=== TWEET ENGAGEMENT FOR SUBMITTED NOTES ===")
pre_imp, post_imp = [], []
pre_likes, post_likes = [], []
pre_followers, post_followers = [], []
for r in submitted:
    dt = r.get("created_at", "")
    imp = r.get("tweet_impressions")
    likes = r.get("tweet_likes")
    followers = r.get("author_followers")
    if imp is not None:
        if dt < "2026-02-16":
            pre_imp.append(imp)
        else:
            post_imp.append(imp)
    if likes is not None:
        if dt < "2026-02-16":
            pre_likes.append(likes)
        else:
            post_likes.append(likes)
    if followers is not None:
        if dt < "2026-02-16":
            pre_followers.append(followers)
        else:
            post_followers.append(followers)

def stats(vals, label):
    if not vals:
        print(f"  {label}: no data")
        return
    vals.sort()
    print(f"  {label}: n={len(vals)}, median={vals[len(vals)//2]:,.0f}, "
          f"mean={sum(vals)/len(vals):,.0f}, p25={vals[int(len(vals)*0.25)]:,.0f}, "
          f"p75={vals[int(len(vals)*0.75)]:,.0f}")

stats(pre_imp, "PRE  impressions")
stats(post_imp, "POST impressions")
stats(pre_likes, "PRE  likes")
stats(post_likes, "POST likes")
stats(pre_followers, "PRE  followers")
stats(post_followers, "POST followers")

# 2. Rating count and view count for notes by bot
print("\n=== NOTE RATINGS & VIEWS BY BOT (submitted before Mar 1) ===")
bot_ratings = defaultdict(list)
bot_views = defaultdict(list)
for r in submitted:
    dt = r.get("created_at", "")
    if dt > "2026-03-01": continue
    bot = config_map.get(r.get("bot_id"), "unknown")
    nid = r.get("note_id")
    c = canon_map.get(nid, {})
    rc = c.get("rating_count")
    vc = c.get("view_count")
    if rc is not None:
        bot_ratings[bot].append(rc)
    if vc is not None:
        bot_views[bot].append(vc)

print(f"{'Bot':>30} {'Notes':>6} {'Med Ratings':>12} {'Med Views':>12}")
for bot in sorted(bot_ratings.keys(), key=lambda b: -len(bot_ratings[b])):
    rats = sorted(bot_ratings[bot])
    views = sorted(bot_views.get(bot, []))
    if len(rats) < 3: continue
    med_r = rats[len(rats)//2]
    med_v = views[len(views)//2] if views else 0
    print(f"{bot:>30} {len(rats):>6} {med_r:>12,.0f} {med_v:>12,.0f}")

# 3. Resolved rate by period (are recent notes getting fewer ratings?)
print("\n=== RESOLUTION RATE BY SUBMISSION WEEK ===")
week_resolved = defaultdict(lambda: {"resolved": 0, "total": 0})
for r in submitted:
    dt = r.get("created_at", "")
    if not dt: continue
    dt_obj = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    w = (dt_obj - timedelta(days=dt_obj.weekday())).strftime("%Y-%m-%d")
    nid = r.get("note_id")
    s = status_of(nid)
    week_resolved[w]["total"] += 1
    if s != "nmr":
        week_resolved[w]["resolved"] += 1

print(f"{'Week':>12} {'Total':>6} {'Resolved':>9} {'Rate':>8}")
for w in sorted(week_resolved.keys()):
    d = week_resolved[w]
    rate = f"{d['resolved']/d['total']*100:.0f}%" if d['total'] else "N/A"
    print(f"{w:>12} {d['total']:>6} {d['resolved']:>9} {rate:>8}")

# 4. opus-main specifically: engagement on its submitted notes pre vs post
print("\n=== OPUS-MAIN TWEET ENGAGEMENT: PRE vs POST Feb 16 ===")
om_pre_imp, om_post_imp = [], []
for r in submitted:
    bot = config_map.get(r.get("bot_id"), "")
    if bot != "opus-main": continue
    dt = r.get("created_at", "")
    imp = r.get("tweet_impressions")
    if imp is None: continue
    if dt < "2026-02-16":
        om_pre_imp.append(imp)
    else:
        om_post_imp.append(imp)
stats(om_pre_imp, "opus-main PRE  impressions")
stats(om_post_imp, "opus-main POST impressions")
