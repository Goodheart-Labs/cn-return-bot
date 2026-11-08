"""Per search arm, for pipeline tweets checked from 17 Sep to 25 Oct (so most
notes have a settled status): checks, cost per check, notes, helpful notes,
cost per submitted note and cost per helpful note."""
import json, collections, pathlib
d = pathlib.Path(__file__).parent
hist = {r["id"]: r for r in json.load(open(d / "history.json"))}
arms = {a["id"]: a for a in json.load(open(d / "arms.json"))}
note_of = {r["id"]: r["note_id"] for r in json.load(open(d / "submitted.json"))}
status = {n["note_id"]: n["cn_status"] for n in json.load(open(d / "noteStatus.json"))}
s = collections.defaultdict(lambda: collections.Counter())
cost = collections.defaultdict(float)
statuses = collections.Counter()
for rid, r in hist.items():
    if not ("2026-09-17" <= r["created_at"][:10] <= "2026-10-25") or r["bot_name"] == "claude-code": continue
    arm = (arms.get(rid) or {}).get("search")
    cost[arm] += float(r["cost"] or 0); s[arm]["checks"] += 1
    if r["outcome"] == "submitted":
        s[arm]["notes"] += 1
        st = status.get(note_of.get(rid))
        statuses[st] += 1
        if st == "CURRENTLY_RATED_HELPFUL": s[arm]["helpful"] += 1
print("statuses:", dict(statuses))
print(f"{'arm':26s} checks  $/check  notes  helpful  hit%   $/note  $/helpful")
for arm, c in sorted(s.items(), key=lambda kv: -kv[1]["checks"]):
    if c["checks"] < 200: continue
    print(f"{str(arm):26s} {c['checks']:6d}  {cost[arm]/c['checks']:.3f}  {c['notes']:5d}  {c['helpful']:5d}  {c['helpful']/max(c['notes'],1):5.1%}  {cost[arm]/max(c['notes'],1):6.2f}  {cost[arm]/max(c['helpful'],1):7.2f}")
