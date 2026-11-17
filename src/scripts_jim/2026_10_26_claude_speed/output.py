"""Where do output tokens (and therefore model time) go: thinking, tool inputs, or replies?"""
import json, sys, collections, datetime as dt
from window import parse_window, transcripts, in_window
SINCE, UNTIL, _ = parse_window(sys.argv[1:])
def ts(s): return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
agg=collections.Counter()
for f in transcripts("", SINCE):
    req=None; msgs={}
    for line in open(f):
        try: d=json.loads(line)
        except: continue
        if d.get("isSidechain") or not in_window(d, SINCE, UNTIL): continue
        if d.get("type")=="api-request": req=ts(d["timestamp"])
        elif d.get("type")=="assistant" and req:
            m=d["message"]; e=msgs.setdefault(m.get("id"),{"start":req,"last":None,"u":{},"text":0,"tool":0,"think":0,"end":False,"toolnames":[]})
            e["last"]=ts(d["timestamp"]); e["u"]=m.get("usage") or e["u"]
            for b in m.get("content") or []:
                if b["type"]=="text": e["text"]+=len(b.get("text",""))
                elif b["type"]=="tool_use":
                    e["tool"]+=len(json.dumps(b.get("input",{}))); e["toolnames"].append(b["name"])
                elif b["type"]=="thinking": e["think"]+=len(b.get("thinking",""))
            if m.get("stop_reason")=="end_turn": e["end"]=True
    for e in msgs.values():
        dur=(e["last"]-e["start"]).total_seconds()
        if not (0<dur<900): continue
        out=e["u"].get("output_tokens",0)
        kind="final reply (end of turn)" if e["end"] and not e["toolnames"] else ("edit/write call" if any(n in("Edit","Write") for n in e["toolnames"]) else "other tool call")
        agg[kind+"|n"]+=1; agg[kind+"|dur"]+=dur; agg[kind+"|out"]+=out
        agg[kind+"|vis"]+=(e["text"]+e["tool"])/4  # visible tokens, ~4 chars per token
        agg[kind+"|thinkvis"]+=e["think"]/4
tot=sum(v for k,v in agg.items() if k.endswith("|dur"))
for kind in ["other tool call","edit/write call","final reply (end of turn)"]:
    n=agg[kind+"|n"]; d=agg[kind+"|dur"]; o=agg[kind+"|out"]; v=agg[kind+"|vis"]
    print(f"{kind:28} n={n:6} time={d/3600:5.1f}h ({d/tot:.0%}) mean {d/n:5.1f}s  out tok mean {o/n:6.0f}  visible ~{v/n:5.0f} -> hidden reasoning ~{1-v/o:.0%}  thinking text logged {agg[kind+'|thinkvis']/n:.0f}")
