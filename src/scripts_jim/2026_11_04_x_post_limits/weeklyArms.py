"""Per ISO week, for the pipeline's own tweets that passed the prefilter: cost
per check, and the share of checks and the cost per check of each search model."""
import json, collections, datetime, pathlib
d = pathlib.Path(__file__).parent
hist = {r["id"]: r for r in json.load(open(d / "history.json"))}
arms = json.load(open(d / "arms.json"))
PREFILTERED = {"prefilter_no_note", "blocked_topic"}
weeks = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0.0, 0]))
for a in arms:
    r = hist.get(a["id"])
    if not r or r["bot_name"] == "claude-code" or r["outcome_reason"] in PREFILTERED or r["cost"] is None: continue
    t = datetime.date.fromisoformat(r["created_at"][:10])
    wk = t - datetime.timedelta(days=t.weekday())
    sub = r["outcome"] == "submitted"
    for key in ("ALL", f"search={a['search']}"):
        s = weeks[wk][key]; s[0] += 1; s[1] += float(r["cost"]); s[2] += sub
for wk in sorted(weeks):
    w = weeks[wk]; all_ = w["ALL"]
    parts = sorted(((k, v) for k, v in w.items() if k != "ALL"), key=lambda kv: -kv[1][0])
    print(f"{wk} checks/day={all_[0]/7:5.0f} $/check={all_[1]/all_[0]:.3f} $/note={all_[1]/max(all_[2],1):.2f}")
    for k, v in parts:
        if v[0] / all_[0] < 0.04: continue
        print(f"      {k[7:]:28s} {v[0]/all_[0]:4.0%} ${v[1]/v[0]:.3f}/check  ${v[1]/max(v[2],1):.2f}/note")
