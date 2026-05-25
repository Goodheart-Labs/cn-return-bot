#!/usr/bin/env python3
"""
Usage watcher for the big_eval dataset build.

The annotation work runs on Claude Code's own token budget (Opus 4.7 + subagents),
so it burns the rolling 5-hour usage window. This watcher reads the active window
via `ccusage` (which parses local Claude Code transcripts under
~/.claude/projects — no API key, and it tracks the *subscription* usage, unlike
the Anthropic Admin API) and manages a PAUSE sentinel so the build stops with
headroom instead of getting hard-cut, then auto-resumes after the window resets.

There is no way for a running agent to read its own usage %, so this runs as a
separate process. Signal: cost (USD) of the active 5h block — the honest single
scalar (raw token totals are dominated by cheap cache-reads).

  PAUSE written   when active-block cost >= PAUSE_FRAC * ceiling
  PAUSE cleared   when the window has reset: a new block id, the recorded block's
                  endTime has passed, no active block, or cost < RESUME_FRAC * ceiling

Ceiling defaults to the historical max completed-block cost (a proxy for "near the
limit"); override with env USAGE_BLOCK_COST_LIMIT or --ceiling.

Usage:
  uv run src/scripts_jim/2026_05_25_big_eval_dataset/usage_watch.py            # loop
  uv run src/scripts_jim/2026_05_25_big_eval_dataset/usage_watch.py --once     # single check
  uv run .../usage_watch.py --ceiling 100 --interval 120
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent.parent.parent
BIG_EVAL_DIR = PROJECT_ROOT / "datasets" / "big_eval"
SENTINEL = BIG_EVAL_DIR / "PAUSE"
LOG = BIG_EVAL_DIR / "usage_watch.log"

PAUSE_FRAC = 0.75
RESUME_FRAC = 0.25
CCUSAGE_CMD = ["bunx", "ccusage@latest", "blocks", "--json"]


def get_blocks() -> list[dict]:
    out = subprocess.run(CCUSAGE_CMD, capture_output=True, text=True, timeout=240)
    text = out.stdout
    start = text.find("{")
    if start == -1:
        raise RuntimeError(f"no JSON from ccusage. stdout={text[:300]!r} stderr={out.stderr[:300]!r}")
    return json.loads(text[start:])["blocks"]


def compute_state(ceiling_override: float | None) -> dict:
    blocks = [b for b in get_blocks() if not b.get("isGap")]
    completed = [b for b in blocks if not b.get("isActive")]
    auto_ceiling = max((b["costUSD"] for b in completed), default=0.0)
    env_ceiling = float(os.environ.get("USAGE_BLOCK_COST_LIMIT") or 0)
    ceiling = ceiling_override or env_ceiling or auto_ceiling
    active = next((b for b in blocks if b.get("isActive")), None)
    cost = active["costUSD"] if active else 0.0
    pct = (cost / ceiling) if ceiling else 0.0
    return {
        "active": bool(active),
        "block_id": active["id"] if active else None,
        "end_time": active["endTime"] if active else None,
        "cost_usd": round(cost, 2),
        "ceiling_usd": round(ceiling, 2),
        "pct": round(pct, 4),
        "ceiling_source": "override" if (ceiling_override or env_ceiling) else "auto(max completed block)",
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def window_has_reset(state: dict, prev: dict | None) -> bool:
    if prev is None:
        return False
    if state["block_id"] != prev.get("block_id"):
        return True
    end = prev.get("end_time")
    if end:
        try:
            if datetime.now(timezone.utc) > datetime.fromisoformat(end.replace("Z", "+00:00")):
                return True
        except ValueError:
            pass
    return False


def update_sentinel(state: dict, pause_frac: float, resume_frac: float) -> str:
    BIG_EVAL_DIR.mkdir(parents=True, exist_ok=True)
    prev = None
    if SENTINEL.exists():
        try:
            prev = json.loads(SENTINEL.read_text())
        except Exception:
            prev = None

    # Reset takes precedence so a paused window clears even with no new activity.
    if prev is not None and (window_has_reset(state, prev) or not state["active"] or state["pct"] < resume_frac):
        SENTINEL.unlink(missing_ok=True)
        return "RESUME"

    if state["pct"] >= pause_frac and state["active"]:
        SENTINEL.write_text(json.dumps({**state, "reason": f"{state['pct']:.0%} >= {pause_frac:.0%} of ${state['ceiling_usd']}"}, indent=2))
        return "PAUSE"

    if prev is None and state["pct"] < pause_frac:
        return "OK"
    return "HOLD" if SENTINEL.exists() else "OK"


def log_line(action: str, state: dict) -> None:
    line = (f"{state['checked_at']}  {action:6}  ${state['cost_usd']:.2f}/${state['ceiling_usd']:.2f} "
            f"({state['pct']:.0%}, {state['ceiling_source']})  active={state['active']}")
    print(line, flush=True)
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="single check, print JSON, exit")
    ap.add_argument("--interval", type=int, default=120, help="seconds between checks (loop mode)")
    ap.add_argument("--ceiling", type=float, default=None, help="block-cost ceiling USD (else env/auto)")
    ap.add_argument("--pause-frac", type=float, default=PAUSE_FRAC)
    ap.add_argument("--resume-frac", type=float, default=RESUME_FRAC)
    args = ap.parse_args()

    if args.once:
        state = compute_state(args.ceiling)
        action = update_sentinel(state, args.pause_frac, args.resume_frac)
        print(json.dumps({"action": action, **state}, indent=2))
        return

    import time
    while True:
        try:
            state = compute_state(args.ceiling)
            action = update_sentinel(state, args.pause_frac, args.resume_frac)
            log_line(action, state)
        except Exception as e:
            print(f"{datetime.now(timezone.utc).isoformat()}  ERROR  {e}", file=sys.stderr, flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
