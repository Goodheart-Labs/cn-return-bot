"""GOO-776 probe: why YouTube serves empty caption files.

Runs on a GitHub runner, where the residential proxy is a secret. For each
video it lists the caption tracks the way the pipeline does (yt-dlp, web
player, PO token, through the proxy), then downloads the chosen track's file
in several ways and prints how many characters each way got back. The proxy
address is never printed.

Usage: PROXY=<url> python3 probe.py <video id>...
"""

import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

PROXY = os.environ["PROXY"]
PROVIDER = "http://127.0.0.1:4416/get_pot"
INTERESTING_PARAMS = ("ip", "ipbits", "sparams", "expire", "pot", "potc", "c", "kind", "lang", "fmt", "exp")


def po_token(video_id: str) -> str:
    request = urllib.request.Request(PROVIDER, data=json.dumps({"content_binding": video_id}).encode(), headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(request, timeout=60))["poToken"]


def sticky_proxy(port: int) -> str:
    return re.sub(r":\d+$", f":{port}", PROXY.rstrip("/"))


def hide(text: str) -> str:
    return text.replace(PROXY, "<proxy>").replace(PROXY.rstrip("/"), "<proxy>")


def dump(video_id: str, token: str, proxy: str) -> dict:
    args = ["yt-dlp", "--proxy", proxy, "--extractor-args", f"youtube:player_client=web;po_token=web.subs+{token}",
            "--dump-single-json", "--skip-download", "--ignore-no-formats-error", f"https://www.youtube.com/watch?v={video_id}"]
    run = subprocess.run(args, capture_output=True, text=True, timeout=120)
    warnings = [line for line in run.stderr.splitlines() if line.strip()]
    if warnings:
        print("    yt-dlp said:", hide(" | ".join(warnings))[:400])
    return json.loads(run.stdout) if run.stdout.strip() else {}


def chosen_track(info: dict) -> tuple[str, str] | None:
    for kind in ("subtitles", "automatic_captions"):
        tracks = info.get(kind) or {}
        for code in ("en-orig", "en", "en-US"):
            for entry in tracks.get(code, []):
                if entry.get("ext") == "vtt" and "tlang" not in entry["url"]:
                    return f"{kind}:{code}", entry["url"]
    return None


def curl(url: str, proxy: str | None) -> str:
    args = ["curl", "-sS", "-m", "40", "-w", "\n__STATUS__%{http_code}", url]
    if proxy:
        args[1:1] = ["-x", proxy]
    run = subprocess.run(args, capture_output=True, text=True)
    body, _, status = run.stdout.rpartition("\n__STATUS__")
    head = body[:40].replace("\n", " ")
    return f"HTTP {status or '-'}, {len(body)} chars, starts {head!r}{(' err ' + hide(run.stderr.strip())[:120]) if run.stderr.strip() else ''}"


def probe(video_id: str, sticky_port: int) -> None:
    print(f"\n=== {video_id}")
    token = po_token(video_id)
    info = dump(video_id, token, PROXY)
    track = chosen_track(info)
    if not track:
        print("    no English track listed")
        return
    label, url = track
    query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    print(f"    track {label}")
    print("    params:", {k: (v[0] if k != "pot" else f"<{len(v[0])} chars>") for k, v in query.items() if k in INTERESTING_PARAMS})
    print("    all param names:", sorted(query))
    print("    A rotating proxy (what the pipeline does):", curl(url, PROXY))
    print("    A again                                  :", curl(url, PROXY))
    print("    B direct from the runner                 :", curl(url, None))
    if "pot" not in query:
        print("    C rotating proxy + pot&c=WEB             :", curl(url + "&" + urllib.parse.urlencode({"pot": token, "c": "WEB"}), PROXY))
    sticky = sticky_proxy(sticky_port)
    sticky_info = dump(video_id, po_token(video_id), sticky)
    sticky_track = chosen_track(sticky_info)
    if sticky_track:
        print("    D same sticky address for list and file  :", curl(sticky_track[1], sticky))
        print("    D file on a different address            :", curl(sticky_track[1], PROXY))
    else:
        print("    D sticky listing found no track (sticky port may not exist)")
    out = f"/tmp/subs-{video_id}"
    run = subprocess.run(["yt-dlp", "--proxy", PROXY, "--extractor-args", f"youtube:player_client=web;po_token=web.subs+{po_token(video_id)}",
                          "--write-subs", "--write-auto-subs", "--sub-langs", "en-orig,en", "--sub-format", "vtt", "--skip-download",
                          "-o", out, f"https://www.youtube.com/watch?v={video_id}"], capture_output=True, text=True, timeout=180)
    files = [f for f in os.listdir("/tmp") if f.startswith(f"subs-{video_id}")]
    sizes = {f: os.path.getsize(f"/tmp/{f}") for f in files}
    print("    E yt-dlp downloads the subs itself       :", sizes or "no files", hide(run.stderr.strip())[-300:])


for index, video in enumerate(sys.argv[1:]):
    probe(video, 10000 + index)
