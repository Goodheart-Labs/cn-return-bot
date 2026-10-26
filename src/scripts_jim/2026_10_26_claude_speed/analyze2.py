"""Split the busy time of Claude Code sessions into model time and tool time.

Model time is the span of each API request, from the request to the last streamed
line of its reply. Tool time is the span of each tool call, from the call to its
result. Where they overlap, the tool wins. Time where neither runs is the agent
waiting for a human or for a background task, and is reported separately.
"""
import json, glob, os, re, sys, collections, datetime as dt
from analyze import classify_tool

ROOT = os.path.expanduser("~/.claude/projects")
SINCE = dt.datetime(2026, 10, 12, tzinfo=dt.timezone.utc)
CAP_S = 3600


def ts(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def intervals(path):
    model, tools, bg = [], [], []
    req = None
    msg_end = {}
    pending = {}
    last_end_turn = None
    for line in open(path):
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if d.get("isSidechain") or not d.get("timestamp"):
            continue
        t = ts(d["timestamp"])
        typ = d.get("type")
        if typ == "api-request":
            req = t
        elif typ == "assistant":
            m = d["message"]
            if req is not None:
                msg_end.setdefault(m.get("id"), [req, t])[1] = t
            for b in m.get("content") or []:
                if b.get("type") == "tool_use":
                    pending[b["id"]] = (t, classify_tool(b["name"], b.get("input", {})))
            if m.get("stop_reason") == "end_turn":
                last_end_turn = t
        elif typ == "user":
            c = d["message"].get("content")
            if isinstance(c, str) and "<task-notification>" in c and last_end_turn:
                if t - last_end_turn < CAP_S:
                    bg.append((last_end_turn, t))
                last_end_turn = None
            elif isinstance(c, list):
                for b in c:
                    if b.get("type") == "tool_result" and b.get("tool_use_id") in pending:
                        start, cat = pending.pop(b["tool_use_id"])
                        if cat != "HUMAN":
                            tools.append((start, min(t, start + CAP_S), cat))
            if not (isinstance(c, str) and "<task-notification>" in c):
                last_end_turn = None
    model = [tuple(v) for v in msg_end.values() if 0 < v[1] - v[0] < 900]
    return model, tools, bg


def busy_split(model, tools):
    """Walk all interval edges; a moment counts for the oldest running tool, else the model."""
    edges = []
    for i, (a, b) in enumerate(model):
        edges += [(a, 1, ("model", i)), (b, -1, ("model", i))]
    for i, (a, b, cat) in enumerate(tools):
        edges += [(a, 1, ("tool", i, cat, a)), (b, -1, ("tool", i, cat, a))]
    edges.sort(key=lambda e: (e[0], e[1]))
    active = {}
    out = collections.Counter()
    prev = None
    for t, kind, key in edges:
        if prev is not None and t > prev and active:
            tool_keys = [k for k in active if k[0] == "tool"]
            label = min(tool_keys, key=lambda k: k[3])[2] if tool_keys else "model"
            out[label] += t - prev
        if kind == 1:
            active[key] = True
        else:
            active.pop(key, None)
        prev = t
    return out


def main():
    for pattern in sys.argv[1:]:
        files = [f for f in glob.glob(f"{ROOT}/-home-jim-dev-repos-{pattern}*/*.jsonl")
                 if os.path.getmtime(f) > SINCE.timestamp()]
        total = collections.Counter()
        bg_total = 0
        for f in files:
            model, tools, bg = intervals(f)
            total.update(busy_split(model, tools))
            bg_total += sum(b - a for a, b in bg)
        busy = sum(total.values())
        print(f"\n=== {pattern}: {len(files)} sessions, busy {busy/3600:.1f} h, waiting on background tasks {bg_total/3600:.1f} h")
        for k, v in total.most_common(12):
            print(f"  {k:36} {v/3600:6.2f} h {v/busy:5.0%}")
        json.dump({"busy": busy, "bg": bg_total, "split": total, "sessions": len(files)},
                  open(f"{os.path.dirname(os.path.abspath(__file__))}/split_{pattern}.json", "w"))


if __name__ == "__main__":
    main()
