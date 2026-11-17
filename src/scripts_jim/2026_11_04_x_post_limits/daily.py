"""Per UTC day: tweets checked by the X bot, their cost, outcomes, and notes submitted."""
import json, collections, pathlib
d = pathlib.Path(__file__).parent
runs = json.load(open(d / "runs.json"))
notes = json.load(open(d / "notes.json"))
days = collections.defaultdict(lambda: collections.Counter())
cost = collections.defaultdict(float)
for r in runs:
    day = r["created_at"][:10]
    days[day]["checked"] += 1
    days[day][f"bot:{r['bot_name']}"] += 1
    days[day][f"out:{r['outcome']}"] += 1
    if r["outcome_reason"] == "queued": days[day]["queued_now"] += 1
    cost[day] += float(r["cost"] or 0)
sub = collections.Counter(n["submitted_at"][:10] for n in notes if n["submitted_at"])
keys = sorted({k for c in days.values() for k in c})
print("day        cost   subm " + " ".join(keys))
for day in sorted(days):
    c = days[day]
    print(f"{day} {cost[day]:6.2f} {sub[day]:4d} " + " ".join(f"{k.split(':')[-1]}={c[k]}" for k in keys if c[k]))
