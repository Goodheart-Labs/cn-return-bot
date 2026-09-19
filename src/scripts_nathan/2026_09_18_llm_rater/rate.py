# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "requests", "python-dotenv"]
# ///
"""LLM rater: one OpenRouter call per (tweet, note) pair.

LEAKAGE CONTROL.  build_prompt() below receives four strings and nothing else:
tweet text, author handle, note text, source URLs.  It cannot see the outcome,
rating counts, the submit date, any pipeline score, or the note's age.  The
strings are handed in by main() from an explicitly whitelisted column list
(PROMPT_COLS); an assert keeps that list honest.

Checkpointing: every finished call is appended to data/ratings.jsonl as it
lands, so a crash loses nothing and a rerun resumes.  Cost comes from
OpenRouter's own usage accounting (usage.include), not an estimate.

Run:  uv run rate.py [--limit N] [--pilot]
"""
import argparse, json, os, random, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

from pairs import build_pairs

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
ENV_FILE = "/Users/natha/Documents/Source/cn-return-bot/.env"
URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-3.8-flash"
OUT = DATA / "ratings.jsonl"
CONCURRENCY = 20
MAX_RETRIES = 5
COST_ABORT_USD = 10.0
MAX_CHARS = 8000          # guard against a pathological tweet; effectively a no-op

# Fixed BEFORE any outcome was looked at.  Printed verbatim in RESULTS.md.
TOPICS = ["politics_us", "politics_world", "war_conflict", "health_medicine", "science_environment",
          "ai_tech", "business_finance", "crypto", "celebrity_entertainment", "sports",
          "crime_justice", "other"]

# The ONLY pair columns that may reach the model.
PROMPT_COLS = ["tweet_text", "author_handle", "note_text", "urls"]

SYSTEM = """You forecast how X (Twitter) Community Notes raters will rate a proposed note.

A note is shown to raters of differing viewpoints. It reaches CURRENTLY_RATED_HELPFUL only if enough raters who usually disagree with each other all rate it helpful. Most notes never get enough ratings and stay at NEEDS_MORE_RATINGS. A few are rated CURRENTLY_RATED_NOT_HELPFUL.

Base rates in this exact feed of notes: about 1 in 10 end up rated helpful, and about 1 in 30 end up rated not helpful. The rest stay unrated. Anchor on those base rates and move away from them only when the note in front of you gives you a reason to.

You are given only the post, the proposed note, and the note's sources. You do not know what happened next. Judge from the text alone. Be calibrated, not charitable: a well-written note is still usually unrated."""

USER_TMPL = """POST by {handle}:
<post>
{tweet}
</post>

PROPOSED COMMUNITY NOTE:
<note>
{note}
</note>

NOTE'S SOURCE URLS:
{urls}

Return one JSON object:
- p_helpful: integer 0-100, the probability this note ends up CURRENTLY_RATED_HELPFUL.
- p_not_helpful: integer 0-100, the probability it ends up CURRENTLY_RATED_NOT_HELPFUL.
- topic: exactly one of {topics}.
- engages: integer 0-100, how directly the note addresses the post's central claim (100 = it rebuts the claim the post's argument rests on; 0 = it corrects only a side detail, or the post makes no factual claim at all).
- reason: one sentence, at most 25 words."""

SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "note_forecast",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "p_helpful": {"type": "integer", "minimum": 0, "maximum": 100},
                "p_not_helpful": {"type": "integer", "minimum": 0, "maximum": 100},
                "topic": {"type": "string", "enum": TOPICS},
                "engages": {"type": "integer", "minimum": 0, "maximum": 100},
                "reason": {"type": "string"},
            },
            "required": ["p_helpful", "p_not_helpful", "topic", "engages", "reason"],
            "additionalProperties": False,
        },
    },
}


def clip(s, n=MAX_CHARS):
    s = "" if s is None else str(s)
    return s if len(s) <= n else s[:n] + " [truncated]"


def build_prompt(tweet_text, author_handle, note_text, urls):
    """Takes four strings. Sees nothing else, by construction."""
    handle = f"@{author_handle}" if author_handle else "(handle not recorded)"
    url_block = "\n".join(f"- {u}" for u in urls) if urls else "(none recorded)"
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": USER_TMPL.format(
            handle=handle, tweet=clip(tweet_text), note=clip(note_text),
            urls=clip(url_block, 1000), topics=", ".join(TOPICS))},
    ]


class Ledger:
    def __init__(self):
        self.lock = threading.Lock()
        self.cost = 0.0
        self.done = 0
        self.fail = 0
        self.aborted = False

    def add(self, rec, fh):
        with self.lock:
            self.cost += rec.get("cost", 0.0) or 0.0
            if rec.get("ok"):
                self.done += 1
            else:
                self.fail += 1
            fh.write(json.dumps(rec) + "\n")
            fh.flush()
            if self.cost > COST_ABORT_USD:
                self.aborted = True
            n = self.done + self.fail
            if n % 50 == 0 or self.aborted:
                print(f"  {n} done ({self.fail} failed)  ${self.cost:.3f}", flush=True)


def call_one(key, note_id, msgs, ledger, fh):
    if ledger.aborted:
        return
    body = {"model": MODEL, "messages": msgs, "response_format": SCHEMA,
            "temperature": 0, "max_tokens": 2000, "usage": {"include": True}}
    err = None
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.post(URL, headers={"Authorization": f"Bearer {key}",
                                            "Content-Type": "application/json"},
                              json=body, timeout=180)
            if r.status_code in (408, 409, 429, 500, 502, 503, 504, 524):
                err = f"http {r.status_code}"
                time.sleep(min(60, 2 ** attempt + random.random() * 2))
                continue
            r.raise_for_status()
            d = r.json()
            if "error" in d and d["error"]:
                err = f"api {str(d['error'])[:200]}"
                time.sleep(min(60, 2 ** attempt + random.random() * 2))
                continue
            usage = d.get("usage") or {}
            txt = d["choices"][0]["message"]["content"]
            parsed = json.loads(txt)
            ledger.add({"note_id": note_id, "ok": True, "attempt": attempt,
                        "cost": float(usage.get("cost") or 0.0),
                        "prompt_tokens": usage.get("prompt_tokens"),
                        "completion_tokens": usage.get("completion_tokens"),
                        **{k: parsed.get(k) for k in
                           ["p_helpful", "p_not_helpful", "topic", "engages", "reason"]}}, fh)
            return
        except Exception as e:  # network, JSON, schema
            err = f"{type(e).__name__}: {str(e)[:200]}"
            time.sleep(min(60, 2 ** attempt + random.random() * 2))
    ledger.add({"note_id": note_id, "ok": False, "error": err, "cost": 0.0}, fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--pilot", action="store_true", help="10 notes, print the prompt and one answer")
    args = ap.parse_args()
    load_dotenv(ENV_FILE)
    key = os.environ["OPENROUTER_API_KEY"]

    _, _, _, df = build_pairs()
    df = df[df["note_text"].fillna("").str.strip().ne("") & df["tweet_text"].fillna("").str.strip().ne("")]
    print(f"ratable pairs: {len(df)}")

    # Leakage assert: the prompt builder only ever sees these four fields.
    assert set(PROMPT_COLS) == {"tweet_text", "author_handle", "note_text", "urls"}

    done = set()
    if OUT.exists():
        for line in OUT.read_text().splitlines():
            if line.strip():
                rec = json.loads(line)
                if rec.get("ok"):
                    done.add(rec["note_id"])
    todo = df[~df["note_id"].isin(done)]
    if args.limit:
        todo = todo.head(args.limit)
    if args.pilot:
        todo = todo.head(10)
    print(f"already rated: {len(done)}   to call: {len(todo)}")
    if args.pilot and len(todo):
        r = todo.iloc[0]
        print("\n=== PROMPT (verbatim, first pilot pair) ===")
        for m in build_prompt(*[r[c] for c in PROMPT_COLS]):
            print(f"--- {m['role']} ---\n{m['content']}\n")

    ledger = Ledger()
    t0 = time.time()
    with open(OUT, "a") as fh:
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
            for _, r in todo.iterrows():
                ex.submit(call_one, key, r["note_id"], build_prompt(*[r[c] for c in PROMPT_COLS]), ledger, fh)
    print(f"\ndone={ledger.done} failed={ledger.fail} cost=${ledger.cost:.4f} "
          f"elapsed={time.time() - t0:.0f}s aborted={ledger.aborted}")
    if ledger.aborted:
        sys.exit("COST ABORT: running cost passed $10.")
    if args.pilot:
        for line in OUT.read_text().splitlines()[-3:]:
            print(line)


if __name__ == "__main__":
    main()
