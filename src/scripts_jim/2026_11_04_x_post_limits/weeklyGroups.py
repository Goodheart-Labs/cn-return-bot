"""Per ISO week: the mean cost per simple-bot check past the prefilter, split by
pipeline step (logs.costs.groups)."""
import json, collections, datetime, pathlib
d = pathlib.Path(__file__).parent
hist = {r["id"]: r for r in json.load(open(d / "history.json"))}
PREFILTERED = {"prefilter_no_note", "blocked_topic"}
weeks = collections.defaultdict(lambda: collections.defaultdict(float)); n = collections.Counter()
for g in json.load(open(d / "groups.json")):
    r = hist.get(g["id"])
    if not r or r["outcome_reason"] in PREFILTERED or not g["groups"]: continue
    t = datetime.date.fromisoformat(r["created_at"][:10]); wk = t - datetime.timedelta(days=t.weekday())
    n[wk] += 1
    for k, v in g["groups"].items(): weeks[wk][k] += float(v.get("cost") or 0)
steps = sorted({k for w in weeks.values() for k in w}, key=lambda k: -sum(w[k] for w in weeks.values()))[:10]
print("week        n     " + " ".join(s[:11].rjust(11) for s in steps))
for wk in sorted(weeks):
    print(f"{wk} {n[wk]:5d} " + " ".join(f"{weeks[wk][s]/n[wk]:11.3f}" for s in steps))
