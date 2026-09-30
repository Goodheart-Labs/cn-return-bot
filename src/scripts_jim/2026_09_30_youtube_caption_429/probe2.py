"""GOO-276 probe 2: do videos that came back without any caption tracks get
them on another try, and what does `yt-dlp --list-subs` print for a video
with dubbed audio tracks?"""

import json
import os
import subprocess
import urllib.request

import yt_dlp

PROXY = os.environ.get("YTDLP_PROXY_URL", "").strip()
NO_TRACKS = ["uuTG3gFHzbE", "bivyc7JmJXM", "v0QqkLJeJqE"]
LISTING = ["SCbpjgol-Gk", "ttVUZOkTxuM", "UKZt1vq8bKI", "qZ-h-zQwDOQ", "o5NRO4E3GzY"]


def hide(text: str) -> str:
    return text.replace(PROXY, "<proxy>") if PROXY else text


def po_token(video_id: str) -> str:
    req = urllib.request.Request("http://127.0.0.1:4416/get_pot", data=json.dumps({"content_binding": video_id}).encode(), headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))["poToken"]


def player_args(video_id: str) -> list[str]:
    return ["--proxy", PROXY, "--extractor-args", f"youtube:player_client=web;po_token=web.subs+{po_token(video_id)}"]


for video_id in NO_TRACKS:
    for n in range(3):
        run = subprocess.run(["yt-dlp", *player_args(video_id), "-J", "--skip-download", "--ignore-no-formats-error", f"https://www.youtube.com/watch?v={video_id}"], capture_output=True, text=True, timeout=120)
        try:
            info = json.loads(run.stdout)
            print(video_id, n + 1, "manual:", sorted(info.get("subtitles") or {}), "auto:", len(info.get("automatic_captions") or {}), "title:", info.get("title"), "availability:", info.get("availability"))
        except Exception:
            print(video_id, n + 1, "no JSON")
        for line in run.stderr.splitlines():
            if "WARNING" in line or "ERROR" in line:
                print("   ", hide(line)[:220])

for video_id in LISTING:
    run = subprocess.run(["yt-dlp", *player_args(video_id), "--list-subs", "--skip-download", "--ignore-no-formats-error", f"https://www.youtube.com/watch?v={video_id}"], capture_output=True, text=True, timeout=120)
    print(f"\n=== listing {video_id}")
    for line in run.stdout.splitlines():
        if "Available" in line or "Language" in line or "-orig" in line or line.startswith("en") or "(Original)" in line:
            print("   ", line[:160])
    print("    rows:", len(run.stdout.splitlines()))
