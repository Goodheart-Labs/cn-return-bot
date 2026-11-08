"""Per ISO week, for pipeline tweets that passed the prefilter: what share ended
in each outcome reason, and the cost per check."""
import json, collections, datetime, pathlib
rows = json.load(open(pathlib.Path(__file__).parent / "history.json"))
PREFILTERED = {"prefilter_no_note", "blocked_topic"}
weeks = collections.defaultdict(collections.Counter); cost = collections.defaultdict(float)
for r in rows:
    if r["bot_name"] == "claude-code" or r["outcome_reason"] in PREFILTERED or r["created_at"] < "2026-06-29": continue
    t = datetime.date.fromisoformat(r["created_at"][:10]); wk = t - datetime.timedelta(days=t.weekday())
    reason = "submitted" if r["outcome"] == "submitted" else (r["outcome_reason"] or r["outcome"])
    weeks[wk][reason] += 1; weeks[wk]["_n"] += 1; cost[wk] += float(r["cost"] or 0)
cols = ["submitted", "no_correction_needed", "check_failed", "below_bar", "low_evaluation_score", "low_materiality_score", "unfetchable_sources", "bot_error", "daily_limit_reached"]
print("week        n     $/chk " + " ".join(c[:12].rjust(12) for c in cols))
for wk in sorted(weeks):
    w = weeks[wk]; n = w["_n"]
    print(f"{wk} {n:5d} {cost[wk]/n:.3f} " + " ".join(f"{w[c]/n:12.0%}" for c in cols))
