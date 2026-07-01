"""Why does the review dashboard show only {bot_id: "simple-bot"} for some notes?

Finding: the runs DO have full logs in PROD. The empty-logs symptom only
reproduces against the LOCAL Supabase, where the pipeline_runs rows exist (so
bot_name is set) but the `logs` JSONB column is NULL — prod->local sync of the
TOASTed logs column is broken. The dashboard then falls back to
buildLogsFallback() (NoteCard.tsx), which emits {bot_id: <bot_name>}.

Run from repo root: uv run src/scripts_jim/2026_06_30_empty_logs_investigation/diagnose.py
"""

import json
import os
import urllib.parse
import urllib.request

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

# note_id -> the two reported notes; we look up the submitted run by tweet_id.
CASES = {
    "Ronaldo World Cup scorer": "2069468360056668528",
    "Elon Musk net worth": "2067212607627661732",
}


def query(base_url: str, key: str, params: dict) -> object:
    url = f"{base_url}/rest/v1/pipeline_runs?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=60).read())
    except Exception as e:  # noqa: BLE001
        return {"ERR": str(e)[:200]}


def logs_size(env_url: str, env_key: str, tweet_id: str) -> str:
    if not env_url:
        return "env not set"
    runs = query(env_url, env_key, {
        "select": "id,bot_name,logs",
        "tweet_id": f"eq.{tweet_id}",
        "outcome": "eq.submitted",
    })
    if isinstance(runs, dict):
        return f"ERR {runs}"
    if not runs:
        return "no submitted run row"
    r = runs[0]
    logs = r["logs"]
    size = len(json.dumps(logs)) if logs else 0
    return f"bot={r['bot_name']} logs={'NULL' if logs is None else f'{size} bytes'}"


for label, tweet_id in CASES.items():
    print(f"\n=== {label} (tweet {tweet_id}) ===")
    print("  PROD :", logs_size(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY"), tweet_id))
    print("  LOCAL:", logs_size(os.environ.get("LOCAL_SUPABASE_URL"), os.environ.get("LOCAL_SUPABASE_SERVICE_KEY"), tweet_id))
