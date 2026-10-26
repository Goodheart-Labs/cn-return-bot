"""Per API request: context size, output tokens, and how long the reply took."""
import json, glob, os, collections, datetime as dt, statistics as st
ROOT=os.path.expanduser("~/.claude/projects")
SINCE=dt.datetime(2026,10,12,tzinfo=dt.timezone.utc)
def ts(s): return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
rows=[]
models=collections.Counter()
for f in glob.glob(f"{ROOT}/-home-jim-dev-repos-*/*.jsonl"):
    if dt.datetime.fromtimestamp(os.path.getmtime(f),dt.timezone.utc)<SINCE: continue
    req=None; msgs={}
    for line in open(f):
        try: d=json.loads(line)
        except: continue
        if d.get("isSidechain"): continue
        if d.get("type")=="api-request": req=ts(d["timestamp"])
        elif d.get("type")=="assistant" and req:
            m=d["message"]; mid=m.get("id")
            u=m.get("usage") or {}
            e=msgs.setdefault(mid,{"start":req,"first":ts(d["timestamp"]),"last":ts(d["timestamp"]),"u":u,"model":m.get("model")})
            e["last"]=ts(d["timestamp"]); e["u"]=u or e["u"]
    for mid,e in msgs.items():
        u=e["u"]; ctx=u.get("input_tokens",0)+u.get("cache_read_input_tokens",0)+u.get("cache_creation_input_tokens",0)
        out=u.get("output_tokens",0)
        dur=(e["last"]-e["start"]).total_seconds()
        if 0<dur<900 and ctx>0:
            rows.append((ctx,out,dur,u.get("cache_creation_input_tokens",0),e["model"]))
            models[e["model"]]+=1
print(len(rows),"requests", models.most_common(5))
buckets=[0,50e3,100e3,150e3,200e3,300e3,400e3,600e3,1e7]
print(f"{'context':>14} {'n':>6} {'median s':>8} {'mean s':>7} {'median out tok':>14} {'s per 1k out':>12} {'share of model time':>8}")
tot=sum(r[2] for r in rows)
for a,b in zip(buckets,buckets[1:]):
    rs=[r for r in rows if a<=r[0]<b]
    if not rs: continue
    durs=[r[2] for r in rs]; outs=[r[1] for r in rs]
    spk=[r[2]/(r[1]/1000) for r in rs if r[1]>500]
    print(f"{int(a/1e3):>5}k-{int(b/1e3):>5}k {len(rs):6} {st.median(durs):8.1f} {st.mean(durs):7.1f} {st.median(outs):14.0f} {st.median(spk) if spk else 0:12.1f} {sum(durs)/tot:8.0%}")
# output tokens buckets
print()
for a,b in [(0,200),(200,1000),(1000,3000),(3000,10000),(10000,1e9)]:
    rs=[r for r in rows if a<=r[1]<b]
    print(f"out {a}-{b}: n={len(rs)} median {st.median([r[2] for r in rs]):.1f}s share {sum(r[2] for r in rs)/tot:.0%}")
# context share
print("median context", st.median([r[0] for r in rows]))
