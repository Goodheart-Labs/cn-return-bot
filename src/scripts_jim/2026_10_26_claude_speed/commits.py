"""How do commits fail in cn-return-bot, and what does Claude do next?"""
import json, sys, re, collections, datetime as dt
from window import parse_window, transcripts, in_window
SINCE, UNTIL, _ = parse_window(sys.argv[1:])
def ts(s): return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
stats=collections.Counter(); reasons=collections.Counter(); nexts=collections.Counter(); examples=[]
lost=0.0; total_commit=0.0
for f in transcripts("cn-return-bot", SINCE):
    calls={}; seq=[]
    for line in open(f):
        try: d=json.loads(line)
        except: continue
        if d.get("isSidechain") or not in_window(d, SINCE, UNTIL): continue
        if d["type"]=="assistant":
            for b in d["message"].get("content") or []:
                if b.get("type")=="tool_use" and b["name"]=="Bash":
                    calls[b["id"]]=(ts(d["timestamp"]),b["input"].get("command",""))
        elif d["type"]=="user" and isinstance(d["message"]["content"],list):
            for b in d["message"]["content"]:
                if b.get("type")=="tool_result" and b.get("tool_use_id") in calls:
                    t0,cmd=calls.pop(b["tool_use_id"])
                    c=b.get("content"); text=c if isinstance(c,str) else " ".join(x.get("text","") for x in c or [] if isinstance(x,dict))
                    seq.append((cmd,text,(ts(d["timestamp"])-t0).total_seconds(),b.get("is_error",False)))
    for i,(cmd,text,dur,err) in enumerate(seq):
        if not re.search(r"\bgit (-C \S+ )?commit\b",cmd) or "--no-verify" in cmd: continue
        stats["commits"]+=1; total_commit+=dur
        failed = "pre-commit script failed" in text or "timed out" in text.lower() or "Command running in background" in text
        if not failed: continue
        stats["failed"]+=1; lost+=dur
        if "Command running in background" in text: r="moved to background after 2 min"
        elif "timed out" in text.lower() or "Command timed out" in text: r="tool timeout (2 min)"
        elif "gitleaks" in text.lower() or "leaks found" in text.lower(): r="gitleaks"
        elif "error TS" in text and 'script "typecheck' in text: r="type error (shown)"
        elif 'script "typecheck' in text: r="type error (hidden by grep -q)"
        elif "eslint" in text.lower() or 'script "lint"' in text or "problem" in text: r="eslint"
        elif "knip" in text.lower() or "Unused" in text: r="knip"
        else: r="other"
        reasons[r]+=1
        nxt=" ".join(s[0][:60] for s in seq[i+1:i+3])
        k="reran a check to see errors" if re.search(r"tsc|typecheck|typescript@|bun run check|eslint|knip",nxt) else "other"
        nexts[(r,k)]+=1
        if len(examples)<12: examples.append((r,text[-300:].replace("\n"," | ")))
print(stats, f"total commit time {total_commit/3600:.1f}h, failed commit time {lost/3600:.1f}h")
print(reasons.most_common()); print(nexts.most_common())
for e in examples: print(e)
