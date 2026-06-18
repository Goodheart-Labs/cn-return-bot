"""Pipeline-run funnel: where do cheap-bot and simple-bot runs stop?

For each bot we bucket every pipeline_run into the furthest stage it reached and
draw a funnel. Stage membership is derived from slim JSONB subpaths of
`pipeline_runs.logs.note_writer_steps` plus the top-level `check_reasoning` /
`outcome` columns, so we never pull the heavy logs blob.

cheap-bot stages:
  pipeline_run -> satire_filter_approved -> note_writer_wrote_non_empty_note
    -> note_needed_judge_approved -> source_verifier_approved -> submission_successful
simple-bot stages:
  pipeline_run -> search_step_says_note_needed -> source_verifier_approves
    -> submission_successful
"""
import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

load_dotenv(Path(__file__).resolve().parents[3] / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

# cheap-bot's history starts 2026-05-29; use the same window for both bots so the
# comparison is apples-to-apples.
SINCE = "2026-05-29"

SELECT = (
    "id, created_at, outcome, check_reasoning,"
    "logs->note_writer_steps->satire_detector->skipped,"
    "logs->note_writer_steps->skipReason,"
    'logs->note_writer_steps->note_writer->attempts->"0"->charCount,'
    'logs->note_writer_steps->note_needed_judge->messages->"1"->content->note_needed'
)

PAGE = 1000


def fetch_runs(bot: str) -> list[dict]:
    """Keyset-paginate all runs for `bot` since SINCE (id is the unique cursor)."""
    rows: list[dict] = []
    last_id = None
    while True:
        q = (
            sb.table("pipeline_runs").select(SELECT)
            .eq("bot_name", bot).gte("created_at", SINCE)
            .order("id").limit(PAGE)
        )
        if last_id is not None:
            q = q.gt("id", last_id)
        batch = q.execute().data
        if not batch:
            break
        rows.extend(batch)
        last_id = batch[-1]["id"]
        if len(batch) < PAGE:
            break
    return rows


def cheap_stages(r: dict) -> dict[str, bool]:
    satire_ok = r.get("skipped") is not True and r.get("skipReason") != "empty_tweet_text"
    wrote = (r.get("charCount") or 0) > 0
    judge_ok = r.get("note_needed") is True
    verifier_ok = r.get("check_reasoning") == "YES"
    submitted = r.get("outcome") == "submitted"
    return {
        "pipeline_run": True,
        "satire_filter_approved": satire_ok,
        "note_writer_wrote_non_empty_note": satire_ok and wrote,
        "note_needed_judge_approved": satire_ok and wrote and judge_ok,
        "source_verifier_approved": satire_ok and wrote and judge_ok and verifier_ok,
        "submission_successful": submitted,
    }


def simple_stages(r: dict) -> dict[str, bool]:
    note_needed = r.get("charCount") is not None  # writer ran => search said note needed
    verifier_ok = r.get("check_reasoning") == "YES"
    submitted = r.get("outcome") == "submitted"
    return {
        "pipeline_run": True,
        "search_step_says_note_needed": note_needed,
        "source_verifier_approves": note_needed and verifier_ok,
        "submission_successful": submitted,
    }


def build_funnel(rows: list[dict], stage_fn) -> dict[str, int]:
    stage_names = list(stage_fn(rows[0] if rows else {}).keys())
    counts = {s: 0 for s in stage_names}
    for r in rows:
        for s, reached in stage_fn(r).items():
            if reached:
                counts[s] += 1
    return counts


def draw_funnel(ax, counts: dict[str, int], title: str, color: str):
    stages = list(counts.keys())
    vals = [counts[s] for s in stages]
    total = vals[0] or 1
    y = range(len(stages))
    ax.barh(y, vals, color=color, height=0.62)
    ax.set_yticks(list(y))
    ax.set_yticklabels(stages, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel("pipeline runs")
    ax.set_title(title, fontsize=12, weight="bold")
    prev = None
    for i, v in enumerate(vals):
        pct_total = 100 * v / total
        step = f"  ({100 * v / prev:.0f}% of prev)" if prev else ""
        ax.text(v, i, f" {v}  ·  {pct_total:.0f}% of runs{step}", va="center", fontsize=8.5)
        prev = v
    ax.margins(x=0.18)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)


cheap_rows = fetch_runs("cheap-bot")
simple_rows = fetch_runs("simple-bot")
cheap = build_funnel(cheap_rows, cheap_stages)
simple = build_funnel(simple_rows, simple_stages)

print(f"\nWindow: since {SINCE}")
print(f"\ncheap-bot ({len(cheap_rows)} runs):")
for s, v in cheap.items():
    print(f"  {v:6d}  {s}")
print(f"\nsimple-bot ({len(simple_rows)} runs):")
for s, v in simple.items():
    print(f"  {v:6d}  {s}")

fig, axes = plt.subplots(2, 1, figsize=(11, 10))
draw_funnel(axes[0], cheap, f"cheap-bot funnel  ({len(cheap_rows)} runs, since {SINCE})", "#4C78A8")
draw_funnel(axes[1], simple, f"simple-bot funnel  ({len(simple_rows)} runs, since {SINCE})", "#E45756")
fig.tight_layout()
out = Path(__file__).resolve().parent / "funnel.png"
fig.savefig(out, dpi=150, bbox_inches="tight")
print(f"\nsaved {out}")
