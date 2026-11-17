"""Per search arm and period: share of checks, cost per checked tweet (all
pipeline tweets, prefiltered included), cost per submitted note, and the share
of submitted notes rated helpful so far."""
import json, collections, pathlib
d = pathlib.Path(__file__).parent
hist = {r["id"]: r for r in json.load(open(d / "history.json"))}
arms = {a["id"]: a for a in json.load(open(d / "arms.json"))}
note_of = {r["id"]: r["note_id"] for r in json.load(open(d / "submitted.json"))}
status = {n["note_id"]: n["cn_status"] for n in json.load(open(d / "noteStatus.json"))}
PERIODS = {"summer 24 Aug-13 Sep": ("2026-08-24", "2026-09-13"), "autumn 21 Sep-11 Oct": ("2026-09-21", "2026-10-11"), "now 26 Oct-4 Nov": ("2026-10-26", "2026-11-04")}
for name, (a, b) in PERIODS.items():
    s = collections.defaultdict(collections.Counter); cost = collections.defaultdict(float)
    for rid, r in hist.items():
        if not (a <= r["created_at"][:10] <= b) or r["bot_name"] != "simple-bot": continue
        for arm in ("ALL", (arms.get(rid) or {}).get("search")):
            s[arm]["checks"] += 1; cost[arm] += float(r["cost"] or 0)
            if r["outcome"] == "submitted":
                s[arm]["notes"] += 1
                st = status.get(note_of.get(rid))
                s[arm]["helpful"] += st == "CURRENTLY_RATED_HELPFUL"
                s[arm]["rated"] += st in ("CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL")
    print(f"== {name}")
    total = s["ALL"]["checks"]
    for arm, c in sorted(s.items(), key=lambda kv: -kv[1]["checks"]):
        if c["checks"] / total < 0.05: continue
        print(f"  {str(arm):24s} {c['checks']/total:4.0%}  ${cost[arm]/c['checks']:.3f}/tweet  {c['notes']/c['checks']:5.1%} become notes  ${cost[arm]/max(c['notes'],1):5.2f}/note  helpful {c['helpful']/max(c['notes'],1):5.1%}  ${cost[arm]/max(c['helpful'],1):6.2f}/helpful")
