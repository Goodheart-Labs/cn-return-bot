"""GOO-276 probe: why does YouTube answer 429 to some caption downloads?

For each video it lists the caption tracks yt-dlp sees as the web player
with a PO token, marks which ones are machine translations (their URL carries
`tlang`), and then downloads single tracks through the residential proxy,
directly, and without the PO token, to see which requests YouTube refuses.
Runs on a GitHub runner, where the proxy secret lives.
"""

import json
import os
import re
import sys
import time
import urllib.request

import yt_dlp
from yt_dlp.networking import Request
from yt_dlp.networking.impersonate import ImpersonateTarget

PROXY = os.environ.get("YTDLP_PROXY_URL", "").strip()
PROVIDER = "http://127.0.0.1:4416/get_pot"
FAILING = ["SCbpjgol-Gk", "uuTG3gFHzbE", "JW6u12FbRGw", "bivyc7JmJXM", "1l3SMlL1n0c", "ttVUZOkTxuM", "o5NRO4E3GzY", "v0QqkLJeJqE", "CTnY6TiVmVQ"]
SUCCEEDED = ["ibbwFzmht9Y", "IxDJvqHlpbQ", "UKZt1vq8bKI", "qZ-h-zQwDOQ"]
TRIES = 2


def hide(text: str) -> str:
    return text.replace(PROXY, "<proxy>") if PROXY else text


def po_token(video_id: str) -> str:
    req = urllib.request.Request(PROVIDER, data=json.dumps({"content_binding": video_id}).encode(), headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))["poToken"]


def make_ydl(proxy: str, token: str | None, langs: list[str] | None = None):
    args = {"player_client": ["web"]}
    if token:
        args["po_token"] = [f"web.subs+{token}"]
    return yt_dlp.YoutubeDL({
        "proxy": proxy, "quiet": True, "no_warnings": True, "skip_download": True, "ignore_no_formats_error": True,
        "writesubtitles": True, "writeautomaticsub": True, "subtitleslangs": langs or ["en.*"],
        "extractor_args": {"youtube": args}, "socket_timeout": 30,
    })


def vtt_url(entries):
    for e in entries:
        if e.get("ext") == "vtt":
            return e["url"]
    return None


def fetch(ydl, url: str, impersonate: bool) -> str:
    started = time.time()
    try:
        ext = {"impersonate": ImpersonateTarget()} if impersonate else {}
        body = ydl.urlopen(Request(url, extensions=ext)).read()
        return f"OK {len(body)}B {time.time() - started:.1f}s"
    except Exception as err:
        return hide(f"FAIL {time.time() - started:.1f}s {str(err)[:160]}")


def probe(video_id: str):
    url = f"https://www.youtube.com/watch?v={video_id}"
    print(f"\n=== {video_id}")
    token = po_token(video_id)
    ydl = make_ydl(PROXY, token)
    try:
        info = ydl.extract_info(url, download=False)
    except Exception as err:
        print(hide(f"extract failed: {err}")[:300])
        return
    subs, autos = info.get("subtitles") or {}, info.get("automatic_captions") or {}
    print("language:", info.get("language"), "| manual:", sorted(subs), "| auto count:", len(autos))
    print("auto keys with en or orig:", sorted(k for k in autos if k.startswith("en") or k.endswith("-orig")))
    print("requested for en.*:", {k: ("tlang" in (v.get("url") or "")) for k, v in (info.get("requested_subtitles") or {}).items()})
    orig = [k for k in autos if k.endswith("-orig")]
    candidates = {}
    for k in ["en", "en-orig", *orig]:
        if k in subs and vtt_url(subs[k]):
            candidates[f"manual:{k}"] = vtt_url(subs[k])
        if k in autos and vtt_url(autos[k]):
            candidates[f"auto:{k}"] = vtt_url(autos[k])
    for key, sub_url in candidates.items():
        tlang = re.search(r"[?&]tlang=([^&]+)", sub_url)
        no_pot = re.sub(r"&(pot|potc|c)=[^&]*", "", sub_url)
        print(f"  {key} tlang={tlang.group(1) if tlang else '-'}")
        for n in range(TRIES):
            print(f"    proxy          #{n + 1}: {fetch(ydl, sub_url, False)}")
            print(f"    proxy+imperson #{n + 1}: {fetch(ydl, sub_url, True)}")
        direct = make_ydl("", token)
        print(f"    direct            : {fetch(direct, sub_url, False)}")
        print(f"    proxy, no pot     : {fetch(ydl, no_pot, False)}")


if __name__ == "__main__":
    print("yt-dlp", yt_dlp.version.__version__)
    for v in (sys.argv[1:] or FAILING + SUCCEEDED):
        probe(v)
