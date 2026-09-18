# /// script
# dependencies = ["curl_cffi", "requests"]
# ///
"""Reddit is the most blocked host in the sample. This probes three ways around
it for the sampled Reddit links: the ".json" form of the post URL through a
Chrome-impersonating client, old.reddit.com through the same client, and the
".json" form with a plain client and an honest user agent.

    uv run src/scripts_jim/2026_09_16_unfetchable_sources/06_reddit_probe.py
"""
from curl_cffi import requests as cffi
import requests
urls=[r["url"] for r in json.load(open("src/scripts_jim/2026_09_16_unfetchable_sources/data/diagnosis.json")) if "reddit.com" in r["url"]][:6]
for u in urls:
    base=u.split("?")[0].rstrip("/")
    variants={"json_cffi": (base+".json", "cffi"), "old_cffi": (base.replace("www.reddit.com","old.reddit.com"), "cffi"),
              "json_plain": (base+".json", "plain")}
    out=[]
    for name,(v,client) in variants.items():
        try:
            r = cffi.get(v, impersonate="chrome", timeout=25, headers={"User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}) if client=="cffi" else requests.get(v, timeout=25, headers={"User-Agent":"cn-return-bot/1.0 (community notes research)"})
            body=r.text
            ok = r.status_code==200 and ("selftext" in body or "\"title\"" in body or "<title>" in body) and "verification" not in body[:3000].lower()
            out.append(f"{name}={r.status_code}{'✓' if ok else '✗'}({len(body)})")
        except Exception as e:
            out.append(f"{name}=ERR {type(e).__name__}")
    print(u[:70], " | ".join(out))
