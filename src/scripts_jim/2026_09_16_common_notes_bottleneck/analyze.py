"""Timing analysis of the Common Notes feed pipeline over the pulled data.

Reads items.json (from pullItems.ts) and runs.json (from gh run list) and
prints, per day and per item, where the time goes.
"""
import json, sys
from collections import defaultdict, Counter
from datetime import datetime, timezone, timedelta

S = sys.argv[1]
d = json.load(open(f"{S}/items.json"))
gh = json.load(open(f"{S}/runs.json"))

def t(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None

items = {i["id"]: i for i in d["items"]}
claims_by_item = defaultdict(list)
for c in d["claims"]:
    claims_by_item[c["item_id"]].append(c)
claim_item = {c["id"]: c["item_id"] for c in d["claims"]}
runs_by_item = defaultdict(list)
seen = set()
for r in d["runs"]:
    if r["id"] in seen: continue
    seen.add(r["id"])
    iid = r["item_id"] or claim_item.get(r["claim_id"])
    if iid: runs_by_item[iid].append(r)

print("=== schedule row ===", d["schedule"])
print("=== per UTC day: items finished, by tier ===")
per_day = defaultdict(lambda: Counter())
cost_day = defaultdict(float)
for i in d["items"]:
    if i["status"] != "done" or not i["processed_at"]: continue
    day = i["processed_at"][:10]
    tier = "requested" if i["priority"] >= 2 else "feed"
    per_day[day][tier] += 1
    if i["skip_reason"]: per_day[day][tier + "_gated"] += 1
for r in d["runs"]:
    if r["cost"]: cost_day[r["created_at"][:10]] += float(r["cost"])
for day in sorted(per_day):
    print(f"  {day}: {dict(per_day[day])}  cost ${cost_day[day]:.2f}")

print("\n=== done feed items since 2026-09-15 13:24Z (cheap pipeline), per item ===")
print("  start(UTC)  dur   extr  rate  chk   n_claims chk'd notes err  cost   src   title")
rows = []
for i in d["items"]:
    if i["priority"] >= 2 or not i["started_at"] or not i["processed_at"]: continue
    if i["started_at"] < "2026-09-15T13:24": continue
    st, en = t(i["started_at"]), t(i["processed_at"])
    rs = sorted(runs_by_item[i["id"]], key=lambda r: r["created_at"])
    ex = [t(r["created_at"]) for r in rs if r["kind"] == "extraction"]
    ra = [t(r["created_at"]) for r in rs if r["kind"] == "rating"]
    ck = [t(r["created_at"]) for r in rs if r["kind"] == "check"]
    cl = claims_by_item[i["id"]]
    cost = sum(float(r["cost"] or 0) for r in rs)
    mins = lambda a, b: f"{(b - a).total_seconds() / 60:4.0f}" if a and b else "   -"
    extr = mins(st, ex[-1]) if ex else "   -"
    rate = mins(ex[-1], ra[-1]) if ex and ra else "   -"
    chk = mins(ra[-1] if ra else (ex[-1] if ex else st), ck[-1]) if ck else "   -"
    stat = Counter(c["status"] for c in cl)
    rows.append((st, en, i))
    print(f"  {i['started_at'][5:16]} {mins(st, en)}  {extr}  {rate}  {chk}   {len(cl):4d}     {len(ck):3d}   {stat['note']:3d}  {stat['error']:3d}  ${cost:5.2f}  {i['source'][:5]:5s} {(i['title'] or i['url'])[:45]}  [{i['status']}{' gated' if i['skip_reason'] else ''}]")

print("\n=== check throughput inside items: checks finished per minute while checking ===")
for st, en, i in rows:
    rs = sorted(runs_by_item[i["id"]], key=lambda r: r["created_at"])
    ck = [t(r["created_at"]) for r in rs if r["kind"] == "check"]
    ra = [t(r["created_at"]) for r in rs if r["kind"] == "rating"]
    if len(ck) < 3 or not ra: continue
    span = (ck[-1] - ra[-1]).total_seconds() / 60
    print(f"  {i['started_at'][5:16]} {len(ck):3d} checks in {span:5.1f} min = {len(ck)/span:4.2f}/min  ({(i['title'] or '')[:40]})")

print("\n=== Actions runs (feed workflow), newest first: queue wait, job length, gap since previous run ended ===")
gh = sorted(gh, key=lambda r: r["createdAt"])
prev_end = None
day_busy = defaultdict(float); day_gap = defaultdict(float); day_runs = Counter()
for r in gh:
    c, s, u = t(r["createdAt"]), t(r["startedAt"]), t(r["updatedAt"])
    wait = (s - c).total_seconds() / 60 if s else 0
    job = (u - s).total_seconds() / 60 if s else 0
    gap = (c - prev_end).total_seconds() / 60 if prev_end else 0
    day = r["createdAt"][:10]
    day_busy[day] += job; day_gap[day] += max(gap, 0); day_runs[day] += 1
    if r["createdAt"] >= "2026-09-15":
        print(f"  {r['createdAt'][5:16]} wait {wait:4.1f}m job {job:5.1f}m gap-before {gap:6.1f}m {r['conclusion']}")
    prev_end = u
print("\n=== per day: runs, minutes in a job, minutes between jobs ===")
for day in sorted(day_runs):
    print(f"  {day}: {day_runs[day]:3d} runs, {day_busy[day]:6.0f} min in jobs, {day_gap[day]:6.0f} min between jobs")
