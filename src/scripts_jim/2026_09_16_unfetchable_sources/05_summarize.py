# /// script
# dependencies = []
# ///
"""Joins the diagnosis with every candidate's results into the tables RESULTS.md
quotes: one cause per URL, and per cause how many URLs each tool recovers.

    uv run src/scripts_jim/2026_09_16_unfetchable_sources/05_summarize.py
"""
import json
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

DATA = Path(__file__).parent / "data"
SOCIAL_HOSTS = ("facebook.com", "instagram.com", "tiktok.com", "youtube.com", "youtu.be", "telegram.me", "t.me", "reddit.com", "redd.it", "x.com", "twitter.com")
CANDIDATES = ["ladder_from_vps", "curl_cffi", "jina", "exa", "exa_fallback", "wayback", "commoncrawl", "patchright", "openrouter"]


def host(url: str) -> str:
    return (urlparse(url).hostname or "").replace("www.", "")


def is_social(url: str) -> bool:
    h = host(url)
    return any(h == s or h.endswith("." + s) for s in SOCIAL_HOSTS)


def good_now(x: dict) -> bool:
    """A 2xx answer with readable text. A 404 page with a long footer is not a recovery."""
    return bool(x.get("good")) and isinstance(x.get("status"), int) and 200 <= x["status"] < 300


def cause(r: dict) -> str:
    plain, cffi = r["plain"], r["curl_cffi"]
    ps, cs = plain["status"], cffi["status"]
    if is_social(r["url"]):
        return "social platform (login wall or app shell)"
    if ps in (404, 410) and cs in (404, 410):
        return "dead link (404 from every client)"
    if good_now(plain):
        return "fetches fine from this VPS with a plain client"
    if good_now(cffi):
        return "TLS fingerprint block (opens once the handshake looks like Chrome)"
    vendor = cffi.get("vendor") or plain.get("vendor")
    if ps == 202 or "awsWafCookieDomainList" in plain.get("body_head", "") or "gokuProps" in plain.get("body_head", ""):
        return "AWS WAF JavaScript challenge"
    if vendor:
        return f"bot defence: {vendor}"
    if ps is None and cs is None:
        return "network error (DNS, timeout, reset)"
    if ps in (401, 402, 403, 429) or cs in (401, 402, 403, 429):
        return f"blocked with HTTP {ps}/{cs}, vendor not identified"
    if (plain.get("body_head") or "").startswith("%PDF") or (cffi.get("body_head") or "").startswith("%PDF"):
        return "PDF (this diagnosis does not parse PDFs; the pipeline does)"
    if ps == 200 or cs == 200:
        return "200 but no readable text (JavaScript app, consent gate or paywall shell)"
    return f"other (HTTP {ps}/{cs})"


def load_candidate(name: str) -> dict[str, dict]:
    path = DATA / f"candidate_{name}.json"
    if not path.exists():
        return {}
    return {r["url"]: r for r in json.loads(path.read_text())}


FETCH_SERVICES = ("jina", "exa", "exa_fallback", "openrouter")


def recovered(name: str, row: dict | None, dead: bool) -> bool | None:
    """A fetch service that answers 200 for a page both direct clients saw as a
    404 has served the site's own "page not found" page, or a homepage redirect,
    with enough footer text to pass the length bar. That is not a recovery. The
    archives are exempt, because an old capture of a since-removed page is one."""
    if row is None:
        return None
    if name == "ladder_from_vps":
        return bool(row["ok"])
    if name in FETCH_SERVICES:
        return bool(row.get("good")) and not dead
    if name in ("wayback", "commoncrawl"):
        return bool(row.get("good"))
    return good_now(row)


def main():
    diag = json.loads((DATA / "diagnosis.json").read_text())
    cands = {name: load_candidate(name) for name in CANDIDATES if name != "curl_cffi"}
    rows = []
    for r in diag:
        c = cause(r)
        row = {"url": r["url"], "host": host(r["url"]), "pipeline": r["pipeline"], "logged_reason": r["logged_reason"], "cause": c,
               "curl_cffi": good_now(r["curl_cffi"])}
        for name, table in cands.items():
            row[name] = recovered(name, table.get(r["url"]), dead=c.startswith("dead link"))
        rows.append(row)
    (DATA / "summary_rows.json").write_text(json.dumps(rows, indent=1))

    n = len(rows)
    print(f"# {n} unique failed sources\n")
    print("## Cause of failure\n")
    print("| cause | urls | share | example |")
    print("|---|---:|---:|---|")
    by_cause = defaultdict(list)
    for row in rows:
        by_cause[row["cause"]].append(row)
    for c, rs in sorted(by_cause.items(), key=lambda kv: -len(kv[1])):
        print(f"| {c} | {len(rs)} | {100 * len(rs) / n:.0f}% | {rs[0]['url'][:80]} |")

    print("\n## Recovery per tool\n")
    tested = {name: sum(1 for row in rows if row.get(name) is not None) for name in CANDIDATES}
    print("| tool | tested | recovered | rate |")
    print("|---|---:|---:|---:|")
    for name in CANDIDATES:
        got = sum(1 for row in rows if row.get(name))
        print(f"| {name} | {tested[name]} | {got} | {100 * got / tested[name] if tested[name] else 0:.0f}% |")

    print("\n## Recovery per tool and cause (recovered / tested)\n")
    print("| cause | " + " | ".join(CANDIDATES) + " |")
    print("|---|" + "---:|" * len(CANDIDATES))
    for c, rs in sorted(by_cause.items(), key=lambda kv: -len(kv[1])):
        cells = []
        for name in CANDIDATES:
            t = [row for row in rs if row.get(name) is not None]
            cells.append(f"{sum(1 for row in t if row[name])}/{len(t)}" if t else "-")
        print(f"| {c} | " + " | ".join(cells) + " |")

    print("\n## Union: what any single addition to the current ladder would buy\n")
    base = {row["url"] for row in rows if row.get("ladder_from_vps")}
    print(f"our ladder from this VPS: {len(base)}")
    for name in CANDIDATES:
        if name == "ladder_from_vps":
            continue
        extra = {row["url"] for row in rows if row.get(name)} - base
        print(f"  + {name}: +{len(extra)} -> {len(base | extra)}")

    print("\n## Hosts still unrecovered by every tool tested\n")
    left = [row for row in rows if not any(row.get(name) for name in CANDIDATES)]
    for h, k in Counter(row["host"] for row in left).most_common(25):
        print(f"  {k:3d} {h}")
    print(f"  total {len(left)}")


if __name__ == "__main__":
    main()
