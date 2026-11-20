"""Summarise every tweet transcript: cost, turns, tool calls by name, subagent use, tokens."""
import json, os, sys, collections, statistics
root = sys.argv[1]
rows = []
for run in sorted(os.listdir(root)):
    f = os.path.join(root, run, "stream.jsonl")
    if not os.path.exists(f): continue
    tools = collections.Counter(); result = None; usage = collections.Counter(); answered = None; model_usage = {}
    sub_tools = collections.Counter()
    for line in open(f):
        try: e = json.loads(line)
        except: continue
        if e.get("type") == "assistant":
            parent = e.get("parent_tool_use_id")
            for c in e["message"].get("content", []):
                if c.get("type") == "tool_use":
                    name = c["name"]
                    if name == "Bash":
                        cmd = c["input"].get("command", "")
                        name = "Bash:x-note" if "x-note " in cmd else "Bash:x-no-note" if "x-no-note" in cmd else "Bash:curl" if "curl" in cmd else "Bash:other"
                    (sub_tools if parent else tools)[name] += 1
        if e.get("type") == "result":
            result = e
    if not result: continue
    u = result.get("usage", {})
    rows.append(dict(run=run, cost=result.get("total_cost_usd"), turns=result.get("num_turns"), ms=result.get("duration_ms"), tools=tools, sub=sub_tools,
                     inp=u.get("input_tokens",0), cache_read=u.get("cache_read_input_tokens",0), cache_write=u.get("cache_creation_input_tokens",0), out=u.get("output_tokens",0),
                     models=result.get("modelUsage", {})))
print("runs with a result:", len(rows))
def stat(k): v=[r[k] for r in rows if r[k] is not None]; return f"mean {statistics.mean(v):.2f} median {statistics.median(v):.2f} p90 {sorted(v)[int(.9*len(v))]:.2f} max {max(v):.2f}"
for k in ["cost","turns","out","cache_read","cache_write","inp"]: print(k, stat(k))
print("minutes", stat("ms") and "")
ms=[r["ms"]/60000 for r in rows if r["ms"]]; print("minutes median %.1f p90 %.1f"%(statistics.median(ms), sorted(ms)[int(.9*len(ms))]))
tot=collections.Counter(); runs_with=collections.Counter()
for r in rows:
    tot.update(r["tools"]); runs_with.update(set(r["tools"]))
print("main-agent tool calls (total, runs using):")
for k,v in tot.most_common(): print(f"  {k}: {v} total, in {runs_with[k]} runs")
st=collections.Counter(); 
for r in rows: st.update(r["sub"])
print("subagent tool calls:", dict(st))
agent_runs=[r for r in rows if r["tools"].get("Agent") or r["tools"].get("Task")]
if agent_runs: print("runs with subagents: %d, mean cost %.2f vs %.2f without"%(len(agent_runs), statistics.mean(r["cost"] for r in agent_runs), statistics.mean(r["cost"] for r in rows if r not in agent_runs)))
mc=collections.defaultdict(float)
for r in rows:
    for m,d in r["models"].items(): mc[m]+=d.get("costUSD",0)
print("cost by model:", {m: round(v,2) for m,v in mc.items()})
json.dump([{**r, "tools": dict(r["tools"]), "sub": dict(r["sub"])} for r in rows], open(os.path.join(os.path.dirname(root),"summary.json"),"w"), default=str)
