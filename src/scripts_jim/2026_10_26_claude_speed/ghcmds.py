import json, sys, re, collections, datetime as dt
from window import parse_window, transcripts, in_window
SINCE, UNTIL, _ = parse_window(sys.argv[1:])
def ts(s): return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
agg=collections.defaultdict(list)
for f in transcripts("", SINCE):
    repo="cn" if "cn-return-bot" in f else ("abb" if "ai-browser" in f else "other")
    calls={}
    for line in open(f):
        try: d=json.loads(line)
        except: continue
        if d.get("isSidechain") or not in_window(d, SINCE, UNTIL): continue
        if d["type"]=="assistant":
            for b in d["message"].get("content") or []:
                if b.get("type")=="tool_use" and b["name"]=="Bash" and not b["input"].get("run_in_background"):
                    calls[b["id"]]=(ts(d["timestamp"]),b["input"].get("command",""))
        elif d["type"]=="user" and isinstance(d["message"]["content"],list):
            for b in d["message"]["content"]:
                if b.get("type")=="tool_result" and b.get("tool_use_id") in calls:
                    t0,cmd=calls.pop(b["tool_use_id"]); dur=(ts(d["timestamp"])-t0).total_seconds()
                    for key,pat in [("gh pr checks --watch / gh run watch",r"gh (pr checks.*--watch|run watch)"),("gh run list/view polling loop",r"(for|until|while).*gh run"),("gh pr create",r"gh pr create"),("gh pr edit/api patch",r"gh (pr edit|api .*PATCH|api -X PATCH)"),("gh pr merge",r"gh pr merge"),("git fetch+merge origin/main",r"git (fetch|merge) .*origin"),("ssh to services box",r"ssh "),("supabase start",r"supabase start"),("sleep N",r"(^|;|&&)\s*sleep \d+")]:
                        if re.search(pat,cmd): agg[(repo,key)].append(dur); break
for k,v in sorted(agg.items(),key=lambda kv:-sum(kv[1])):
    print(f"{k[0]:4} {k[1]:40} n={len(v):5} total {sum(v)/3600:5.2f}h mean {sum(v)/len(v):6.1f}s")
