"""
Two views of arrival-velocity vs. helpfulness, on one log-velocity x-axis.

  velocity = impressions (frozen at first sight) / age at first sight,
             age clamped to VELOCITY_MIN_AGE_HOURS = 0.25h
             (matches src/pipeline/utils/velocity.ts + run.ts).

Line A  — distribution of helpful notes:
          % of helpful notes whose arrival velocity was <= threshold  (a CDF).

Line B  — helpful hit-rate below a ceiling:
          % of ALL notes with arrival velocity <= threshold that ended up
          CURRENTLY_RATED_HELPFUL.

Both lines are computed over the same SETTLED population (submitted before
SETTLED_CUTOFF) so recent, still-in-flight notes don't deflate line B's rate.

  uv run src/scripts_jim/2026_07_21_velocity_helpful/plot_velocity_vs_helpful.py
"""
import os
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
from dotenv import load_dotenv
from supabase import create_client

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

HERE = Path(__file__).resolve().parent
OUT_PNG = HERE / "velocity_vs_helpful.png"

VELOCITY_MIN_AGE_HOURS = 0.25
HELPFUL = "CURRENTLY_RATED_HELPFUL"
SETTLED_CUTOFF = "2026-07-17"   # ratings have had time to land before this
REGULAR_FLOOR = 30_000          # REGULAR_VELOCITY_FLOOR_PER_HOUR
TOPIC_FLOOR = 4_000             # MISINFO_TOPIC_VELOCITY_FLOOR_PER_HOUR
MIN_BELOW_N = 20                # stop line B once the population below gets noisy
PAGE = 1000


def fetch_settled_notes():
    rows, offset = [], 0
    while True:
        resp = (sb.table("notes")
                .select("note_id, tweet_id, cn_status, submitted_at")
                .not_.is_("submitted_at", "null")
                .order("note_id")
                .range(offset, offset + PAGE - 1).execute())
        rows.extend(resp.data)
        if len(resp.data) < PAGE:
            break
        offset += PAGE
    return [r for r in rows if r["submitted_at"][:10] < SETTLED_CUTOFF]


def fetch_tweets(tweet_ids):
    by_id, ids = {}, list(tweet_ids)
    for i in range(0, len(ids), 150):
        resp = (sb.table("tweets")
                .select("tweet_id, impressions, posted_at, first_seen_at")
                .in_("tweet_id", ids[i:i + 150]).execute())
        for t in resp.data:
            by_id[t["tweet_id"]] = t
    return by_id


def age_hours(posted_at, first_seen_at):
    posted = np.datetime64(posted_at.replace("Z", "").split("+")[0])
    seen = np.datetime64(first_seen_at.replace("Z", "").split("+")[0])
    return (seen - posted) / np.timedelta64(1, "h")


print("Fetching settled submitted notes...")
notes = fetch_settled_notes()
print(f"  {len(notes)} settled notes (submitted before {SETTLED_CUTOFF})")

tweets = fetch_tweets({n["tweet_id"] for n in notes})

vel, helpful = [], []
missing_tweet = missing_data = 0
for n in notes:
    t = tweets.get(n["tweet_id"])
    if t is None:
        missing_tweet += 1
        continue
    if t["impressions"] is None or not t["posted_at"] or not t["first_seen_at"]:
        missing_data += 1
        continue
    ah = max(age_hours(t["posted_at"], t["first_seen_at"]), VELOCITY_MIN_AGE_HOURS)
    v = t["impressions"] / ah
    if not np.isfinite(v):
        missing_data += 1
        continue
    vel.append(v)
    helpful.append(n["cn_status"] == HELPFUL)

vel = np.array(vel)
helpful = np.array(helpful, dtype=bool)
n_all, n_help = len(vel), int(helpful.sum())
print(f"  usable: {n_all}  ({n_help} helpful, {100*n_help/n_all:.1f}%)"
      f"  [dropped {missing_tweet} no-tweet, {missing_data} missing data]")

# ── Threshold grid over the full velocity range ─────────────────────────────
grid = np.logspace(np.log10(max(vel.min(), 1)), np.log10(vel.max()), 400)

help_vel = np.sort(vel[helpful])
# Line A: % of helpful notes with velocity <= t  (CDF)
line_a = np.array([100.0 * np.count_nonzero(help_vel <= t) / n_help for t in grid])

# Line B: % of all notes with velocity <= t that are helpful (blank once thin)
line_b = np.full_like(grid, np.nan)
for i, t in enumerate(grid):
    below = vel <= t
    n_below = int(below.sum())
    if n_below >= MIN_BELOW_N:
        line_b[i] = 100.0 * int(helpful[below].sum()) / n_below

print(f"\n  baseline helpful rate (all settled): {100*n_help/n_all:.1f}%")
for f, label in [(TOPIC_FLOOR, "4K/h"), (REGULAR_FLOOR, "30K/h")]:
    below = vel <= f
    rate = 100 * int(helpful[below].sum()) / int(below.sum())
    cdf = 100 * np.count_nonzero(help_vel <= f) / n_help
    print(f"  at {label}: {cdf:.0f}% of helpful notes are <= here | "
          f"helpful rate below = {rate:.1f}% ({int(helpful[below].sum())}/{int(below.sum())})")

# ── Plot ────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(10, 6))
ax.plot(grid, line_a, color="#2563eb", lw=2.2,
        label=f"% of helpful notes with velocity ≤ x  (n={n_help})")
ax.plot(grid, line_b, color="#ea580c", lw=2.2,
        label=f"% helpful among notes with velocity ≤ x  (n={n_all})")
ax.axhline(100 * n_help / n_all, color="#ea580c", ls=":", lw=1,
           alpha=0.6, label=f"baseline helpful rate ({100*n_help/n_all:.0f}%)")

ax.set_xscale("log")
ax.set_xlabel("Arrival velocity threshold (impressions / hour)")
ax.set_ylabel("Percent")
ax.set_title("Arrival velocity: helpful-note distribution vs. helpful rate below a ceiling")
ax.grid(True, which="both", ls=":", alpha=0.4)
ax.set_ylim(0, 100)

for f, name, color in [(TOPIC_FLOOR, "topic 4K/h", "#059669"),
                       (REGULAR_FLOOR, "regular 30K/h", "#dc2626")]:
    ax.axvline(f, color=color, ls="--", lw=1.2, alpha=0.7)
    ax.annotate(name, xy=(f, 2), xytext=(f * 1.05, 2),
                color=color, fontsize=8, rotation=90, va="bottom")

ax.legend(loc="center left", fontsize=9, framealpha=0.9)
fig.tight_layout()
fig.savefig(OUT_PNG, dpi=140)
print(f"\nWrote {OUT_PNG}")
