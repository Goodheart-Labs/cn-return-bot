"""Splits every feed run of one day into phases by the timestamps in its log:
runner setup, health and triage, creator walk, top-posts refresh, the item
itself, and the tail. Prints the day's minutes per phase and per outcome."""
import re, sys, glob
from collections import Counter, defaultdict
from datetime import datetime

def ts(line):
    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)", line)
    return datetime.fromisoformat(m.group(1)) if m else None

phase_min = Counter(); outcome_min = Counter(); outcomes = Counter(); n = 0
walk_lengths = []; item_rows = []
for path in sorted(glob.glob(sys.argv[1] + "/*.txt")):
    lines = open(path, errors="replace").read().splitlines()
    marks = {}
    for l in lines:
        t = ts(l)
        if not t: continue
        if "job_start" not in marks: marks["job_start"] = t
        if "bun run src/everything/autoRun.ts" in l: marks.setdefault("pipeline_start", t)
        if "CREATORS ·" in l: marks.setdefault("walk_start", t)
        if "[top-posts]" in l and "refresh" in l: marks.setdefault("top_start", t)
        if "walked " in l and " of " in l: marks.setdefault("walk_end", t)
        if "Enqueued " in l: marks.setdefault("enqueue_end", t)
        if "CHECKING NOW" in l: marks.setdefault("item_start", t)
        if "finished in " in l or "failed after " in l or "not checkable:" in l or "put back in the queue" in l:
            marks.setdefault("item_end", t)
            marks.setdefault("outcome", "error" if "failed after" in l else "gated" if "not checkable" in l else "capped" if "put back" in l else "done")
        if "Nothing to process" in l: marks.setdefault("outcome", "empty")
        if "run done" in l: marks.setdefault("pipeline_end", t)
        marks["job_end"] = t
    if "pipeline_start" not in marks: continue
    n += 1
    g = marks.get
    def add(name, a, b):
        if g(a) and g(b): phase_min[name] += (g(b) - g(a)).total_seconds() / 60
    add("1 runner setup before pipeline", "job_start", "pipeline_start")
    add("2 health + triage + pacing", "pipeline_start", "walk_start" if g("walk_start") else "item_start")
    if g("walk_start"):
        add("3 creator walk (listing feeds)", "walk_start", "walk_end")
        add("4 after walk: top posts + enqueue", "walk_end", "enqueue_end")
        walk_lengths.append((g("walk_end") - g("walk_start")).total_seconds() / 60 if g("walk_end") else 0)
    add("5 item processing", "item_start", "item_end")
    add("6 tail (alarm, browser close, cleanup)", "item_end" if g("item_end") else "enqueue_end" if g("enqueue_end") else "pipeline_start", "job_end")
    oc = g("outcome", "none")
    outcomes[oc] += 1
    if g("item_start") and g("item_end"): outcome_min[oc] += (g("item_end") - g("item_start")).total_seconds() / 60
total = sum(phase_min.values())
print(f"{n} runs, {total:.0f} min of runner time")
for k in sorted(phase_min): print(f"  {phase_min[k]:6.0f} min  {phase_min[k]/n:5.1f}/run  {k}")
print("item outcomes:", dict(outcomes))
print("item minutes by outcome:", {k: round(v) for k, v in outcome_min.items()})
print(f"walk ran in {len(walk_lengths)} runs, mean {sum(walk_lengths)/max(len(walk_lengths),1):.1f} min")
