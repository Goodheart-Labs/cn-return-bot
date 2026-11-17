"""Attribute the wall-clock time of Claude Code sessions to what the agent was doing.

Walks every main-thread transcript in ~/.claude/projects for the given repos and
splits the timeline into intervals. Each interval belongs to the state the
session was in: the model generating, a tool running (classified by command),
waiting for a background task, or waiting for a human (excluded from agent time).
"""
import json, glob, os, re, sys, collections, datetime as dt

ROOT = os.path.expanduser("~/.claude/projects")
SINCE = dt.datetime(2026, 10, 12, tzinfo=dt.timezone.utc)
MAX_GAP_S = 3600  # a single interval longer than this is idle time, not work


def ts(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


BASH_RULES = [
    ("git commit (pre-commit hook)", r"\bgit (-C \S+ )?commit\b"),
    ("bun run check / typecheck", r"bun run (check|typecheck)|\btsc\b|typescript@|native-preview|npm run (typecheck|check)|npx tsc"),
    ("tests", r"\bbun test\b|vitest|npm (run )?test|playwright test|jest"),
    ("lint / knip / prettier", r"eslint|bun run lint|knip|prettier"),
    ("build", r"bun run build|vite build|wxt (build|zip)|build-ext|gradle|xcodebuild"),
    ("install deps", r"bun install|npm (ci|install)|uv sync|pip install"),
    ("git push / fetch / merge", r"\bgit (push|fetch|merge|pull|rebase)\b"),
    ("gh / CI", r"\bgh (run|pr checks|api|workflow)|gh pr"),
    ("sleep / wait loops", r"\bsleep\b|until |while "),
    ("supabase / docker", r"supabase|docker|psql"),
    ("browser / screenshots", r"preview\.ts|chromium|playwright|puppeteer|cn-ext-push"),
    ("scripts (bun/uv/python run)", r"\bbun run\b|\buv run\b|python3?\b|\bbun \S+\.ts|node "),
    ("read / search (shell)", r"^\s*(cat|sed|grep|rg|ls|find|head|tail|wc|git (log|show|diff|status|grep))\b"),
]


def classify_tool(name, inp):
    if name == "Bash":
        cmd = inp.get("command", "")
        if inp.get("run_in_background"):
            return "start background task"
        for label, pat in BASH_RULES:
            if re.search(pat, cmd):
                return label
        return "other shell"
    if name in ("Read", "Grep", "Glob"):
        return "read / search (tools)"
    if name in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        return "edit files"
    if name in ("Agent", "Task"):
        return "subagent (foreground)"
    if name in ("AskUserQuestion", "ExitPlanMode", "EnterPlanMode"):
        return "HUMAN"
    if name.startswith("mcp__linear") or name.startswith("mcp__plane"):
        return "tickets (Linear / Plane)"
    if name in ("WebSearch", "WebFetch"):
        return "web"
    if name.startswith("Artifact"):
        return "artifacts"
    if name == "Monitor":
        return "monitor / wait"
    if name == "Skill" or name == "ToolSearch":
        return "skills / tool search"
    return "other tool: " + name.split("__")[0]


def analyze(path):
    """Return {category: seconds}, plus per-command samples, for one transcript."""
    events = []  # (time, kind, payload)
    pending = {}  # tool_use_id -> (category, start, cmd)
    samples = []
    compactions = []
    for line in open(path):
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if d.get("isSidechain"):
            continue
        t = d.get("timestamp")
        if not t:
            continue
        t = ts(t)
        typ = d.get("type")
        if typ == "api-request":
            events.append((t, "model", None))
        elif typ == "assistant":
            for block in d["message"].get("content", []) or []:
                if block.get("type") == "tool_use":
                    cat = classify_tool(block["name"], block.get("input", {}))
                    pending[block["id"]] = (cat, t, block.get("input", {}).get("command", block["name"]))
                    events.append((t, "tool_start", (block["id"], cat)))
            if d["message"].get("stop_reason") == "end_turn":
                events.append((t, "end_turn", None))
        elif typ == "user":
            content = d["message"].get("content")
            if isinstance(content, str):
                kind = "notification" if "<task-notification>" in content else "human_msg"
                events.append((t, kind, None))
            else:
                for block in content or []:
                    if block.get("type") == "tool_result" and block.get("tool_use_id") in pending:
                        cat, start, cmd = pending.pop(block["tool_use_id"])
                        dur = (t - start).total_seconds()
                        text = json.dumps(block.get("content"))[:400]
                        samples.append((cat, dur, str(cmd)[:160], "timed out" in text.lower() or "timeout" in text.lower() and dur > 115))
                        events.append((t, "tool_end", block["tool_use_id"]))
                    elif block.get("type") == "text":
                        events.append((t, "human_msg", None))
        elif typ == "system" and d.get("subtype") == "compact_boundary":
            meta = d.get("compactMetadata", {})
            compactions.append((meta.get("durationMs", 0) / 1000, meta.get("preTokens", 0)))

    # Walk the timeline: the state between two events is decided by what was
    # happening at the earlier one.
    totals = collections.Counter()
    events.sort(key=lambda e: e[0])
    open_tools = {}
    cats = {}
    for line_cat, _, _, _ in samples:
        pass
    # Rebuild tool categories for the walk.
    state = "idle"
    for i, (t, kind, payload) in enumerate(events):
        if kind == "tool_start":
            open_tools[payload[0]] = (t, payload[1])
        elif kind == "tool_end":
            open_tools.pop(payload, None)
        elif kind == "human_msg":
            open_tools.clear()
        if kind == "model":
            state = "model"
        elif kind == "tool_start":
            state = "tool"
        elif kind == "tool_end":
            state = "tool" if open_tools else "model_wait"
        elif kind == "end_turn":
            state = "idle"
        elif kind in ("human_msg", "notification"):
            state = "model_wait"
        if i + 1 < len(events):
            gap = (events[i + 1][0] - t).total_seconds()
            if gap <= 0:
                continue
            if state == "idle":
                nxt = events[i + 1][1]
                label = "background wait" if nxt == "notification" else "HUMAN"
                if gap > MAX_GAP_S:
                    label = "HUMAN"
                totals[label] += gap
            elif state in ("model", "model_wait"):
                totals["model (thinking + writing)"] += min(gap, MAX_GAP_S)
            elif state == "tool" and open_tools:
                oldest = min(open_tools.values())[1]
                if oldest == "HUMAN":
                    totals["HUMAN"] += gap
                else:
                    totals["__tool"] += min(gap, MAX_GAP_S)
                    totals["cat:" + oldest] += min(gap, MAX_GAP_S)
    return totals, samples, compactions


def main():
    repos = sys.argv[1:] or ["cn-return-bot", "ai-browser-blocker"]
    for repo in repos:
        files = [f for f in glob.glob(f"{ROOT}/-home-jim-dev-repos-{repo}*/*.jsonl")
                 if dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc) > SINCE]
        totals = collections.Counter()
        bycat = collections.Counter()
        counts = collections.Counter()
        timeouts = collections.Counter()
        allsamples = []
        comp = []
        for f in files:
            tt, samples, c = analyze(f)
            totals.update(tt)
            comp += c
            for cat, dur, cmd, to in samples:
                dur = min(dur, MAX_GAP_S)
                bycat[cat] += dur
                counts[cat] += 1
                timeouts[cat] += to
                allsamples.append((dur, cat, cmd))
        wall = collections.Counter({k[4:]: v for k, v in totals.items() if k.startswith("cat:")})
        for k in list(totals):
            if k.startswith("cat:"):
                totals.pop(k)
        bycat = wall
        tool_time = totals.pop("__tool", 0)
        human = totals.pop("HUMAN", 0)
        bg = totals.pop("background wait", 0)
        model = totals["model (thinking + writing)"]
        agent = model + tool_time + bg
        print(f"\n=== {repo}: {len(files)} sessions since {SINCE.date()} ===")
        print(f"agent wall time {agent/3600:.1f} h | model {model/3600:.1f} h ({model/agent:.0%}) | tools (wall) {tool_time/3600:.1f} h ({tool_time/agent:.0%}) | background-wait {bg/3600:.1f} h ({bg/agent:.0%}) | human excluded {human/3600:.1f} h")
        print(f"compactions: {len(comp)}, total {sum(c[0] for c in comp)/60:.0f} min, mean pre-tokens {sum(c[1] for c in comp)/max(1,len(comp)):.0f}")
        tool_sum = sum(bycat.values())
        print(f"{'category':38} {'calls':>6} {'hours':>6} {'share':>6} {'mean s':>7} {'p90 s':>6} timeouts")
        for cat, s in bycat.most_common(14):
            durs = sorted(d for d, c, _ in allsamples if c == cat)
            p90 = durs[int(len(durs) * 0.9)] if durs else 0
            print(f"{cat:38} {counts[cat]:6} {s/3600:6.1f} {s/tool_sum:6.0%} {s/max(1,counts[cat]):7.1f} {p90:6.0f} {timeouts[cat]}")
        json.dump({"agent": agent, "model": model, "tool": tool_time, "bg": bg, "human": human,
                   "bycat": bycat, "counts": counts, "sessions": len(files),
                   "compactions": comp,
                   "top": sorted(allsamples, reverse=True)[:60]},
                  open(f"{os.path.dirname(__file__)}/analysis_{repo}.json", "w"), default=str, indent=1)


if __name__ == "__main__":
    main()
