"""Per ISO week: tweets checked, cost per day, notes submitted per day, cost per
submitted note, and the share of checked tweets that became a submitted note."""
import json, collections, datetime, pathlib
rows = json.load(open(pathlib.Path(__file__).parent / "history.json"))
weeks = collections.defaultdict(lambda: {"n": 0, "cost": 0.0, "sub": 0, "days": set(), "costed": 0})
for r in rows:
    t = datetime.date.fromisoformat(r["created_at"][:10])
    w = weeks[t - datetime.timedelta(days=t.weekday())]
    w["n"] += 1; w["days"].add(t)
    if r["cost"] is not None: w["cost"] += float(r["cost"]); w["costed"] += 1
    if r["outcome"] == "submitted": w["sub"] += 1
print("week        checked/day  $/day  notes/day  $/note  note-rate  rows-with-cost")
for wk in sorted(weeks):
    w = weeks[wk]; d = len(w["days"])
    print(f"{wk}  {w['n']/d:8.0f}  {w['cost']/d:6.2f}  {w['sub']/d:6.1f}  {w['cost']/max(w['sub'],1):6.2f}  {w['sub']/w['n']:7.1%}  {w['costed']/w['n']:5.0%}")
