# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn", "requests"]
# ///
"""Which posts that end up with a helpful note would each rule filter out? (GOO-863)

Jim's question: the X run sees every post in the feed, also the ones it filters
out. Join them with the public Community Notes data and ask how many of the
posts that do get a helpful note each rule would have let through.

The posts are those the feed view recorder saw from their first sighting, so
both rules can be replayed on them: posts published after the recording
started. Every half hour, as the X run does, each post younger than 24 hours
is checked against

  - the old rule: views per hour since posting of at least 15,000,
  - the new rule: predicted views still to come of at least 200,000,
    from the speed over the last 10 minutes (viewsToCome.ts).

A post counts as let through at the first run where it clears the floor. A
post has a helpful note when any author's note that calls it misleading is
"currently rated helpful" in the newest public dump. The dump lags about two
days, and a note takes a day or more to become helpful, so only posts
published at least DUMP_SETTLE_DAYS before the dump's newest note are counted.

It also prints the same comparison for other floors, as the share of all posts
let through against the share of helpful-note posts let through, so a floor
can be chosen on it. Each helpful-note post, with its notes, its link and both
rules' numbers, goes to backtest_helpful_posts.json in the data folder.

    uv run src/scripts_jim/2026_11_21_feed_views_model/backtest_helpful.py
"""

import io
import json
import zipfile
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests

import evaluate as ev
import production_fit as pf

DUMP_URL = "https://ton.twimg.com/birdwatch-public-data"
DUMP_DIR = ev.DATA_DIR.parent / "cn-public-data"
DUMP_FILES = {"notes": ["notes-00000", "notes-00001"], "noteStatusHistory": ["noteStatusHistory-00000"]}
DUMP_DAYS_BACK = 7
DUMP_SETTLE_DAYS = 2
MISLEADING = "MISINFORMED_OR_POTENTIALLY_MISLEADING"
HELPFUL = "CURRENTLY_RATED_HELPFUL"
VELOCITY_FLOORS = [5_000, 10_000, 15_000, 30_000, 60_000]
VIEWS_FLOOR = 200_000
VIEWS_FLOORS = [50_000, 100_000, 200_000, 400_000, 800_000]


def newest_dump() -> tuple[str, dict[str, list]]:
    """Downloads the newest dump into cn-public-data/<date>/ unless it is there, and returns its date and files."""
    for back in range(DUMP_DAYS_BACK):
        day = datetime.now(timezone.utc) - timedelta(days=back)
        folder = DUMP_DIR / day.strftime("%Y-%m-%d")
        paths = {kind: [folder / f"{name}.zip" for name in names] for kind, names in DUMP_FILES.items()}
        if all(p.exists() for ps in paths.values() for p in ps):
            return day.strftime("%Y-%m-%d"), paths
        base = f"{DUMP_URL}/{day.strftime('%Y/%m/%d')}"
        if requests.head(f"{base}/noteStatusHistory/noteStatusHistory-00000.zip", timeout=30).status_code != 200:
            continue
        folder.mkdir(parents=True, exist_ok=True)
        for kind, ps in paths.items():
            for p in ps:
                r = requests.get(f"{base}/{kind}/{p.name}", timeout=600)
                r.raise_for_status()
                p.write_bytes(r.content)
        return day.strftime("%Y-%m-%d"), paths
    raise SystemExit("no public dump in the last week")


def helpful_notes(paths: dict[str, list]) -> tuple[pd.DataFrame, pd.Timestamp]:
    """The helpful misleading notes, and when the dump's newest note was written."""
    notes = pd.concat(pd.read_csv(p, sep="\t", compression="zip", usecols=["noteId", "createdAtMillis", "tweetId", "classification", "summary"],
                                  dtype={"noteId": str, "tweetId": str}) for p in paths["notes"])
    status = pd.read_csv(paths["noteStatusHistory"][0], sep="\t", compression="zip", usecols=["noteId", "currentStatus"], dtype={"noteId": str})
    newest = pd.to_datetime(notes.createdAtMillis.max(), unit="ms", utc=True)
    return notes[notes.classification == MISLEADING].merge(status[status.currentStatus == HELPFUL], on="noteId"), newest


def first_admissions(runs: pd.DataFrame, column: str, floor: float) -> pd.DataFrame:
    """Each post's first replayed run where `column` clears `floor`."""
    hit = runs[runs[column] >= floor].sort_values("run")
    return hit.assign(tweet_id=hit.tweet_id.astype(str)).groupby("tweet_id").first()


def write_details(hits: set[str], runs: pd.DataFrame, notes: pd.DataFrame, v48: dict) -> None:
    """Each helpful-note post with its notes, its link and both rules' numbers at the replayed runs."""
    runs = runs.assign(tweet_id=runs.tweet_id.astype(str))
    out = []
    for t in sorted(hits):
        r = runs[runs.tweet_id == t].sort_values("run")
        first = r.iloc[0]
        old = r[r.velocity >= pf.VELOCITY_FLOOR_PER_H]
        new = r[r.predicted >= VIEWS_FLOOR]
        out.append({
            "tweet": f"https://x.com/i/status/{t}",
            "notes": notes[notes.tweetId == t].summary.tolist(),
            "first_seen_age_h": round(float(first.age), 1),
            "views_at_48h": v48.get(t),
            "velocity_first_seen": round(float(first.velocity)),
            "predicted_first_seen": None if pd.isna(first.predicted) else round(float(first.predicted)),
            "predicted_max_before_24h": None if r.predicted.isna().all() else round(float(r.predicted.max())),
            "old_rule_lets_through_at_age_h": round(float(old.iloc[0].age), 1) if len(old) else None,
            "new_rule_lets_through_at_age_h": round(float(new.iloc[0].age), 1) if len(new) else None,
        })
    path = ev.DATA_DIR / "backtest_helpful_posts.json"
    path.write_text(json.dumps(out, indent=1))
    print(f"  wrote {len(out)} helpful-note posts with their notes and numbers to {path}")


def main() -> None:
    p = json.loads((ev.DATA_DIR / "live_cliff.json").read_text())
    views, _ = ev.load()
    started = views.observed_at.min()
    day, paths = newest_dump()
    notes, newest_note = helpful_notes(paths)
    helpful = set(notes.tweetId)
    cutoff = newest_note - pd.Timedelta(days=DUMP_SETTLE_DAYS)
    print(f"dump {day}: newest note {newest_note:%Y-%m-%d %H:%M}, counting posts published {started:%m-%d %H:%M} to {cutoff:%m-%d %H:%M} UTC")

    posted = views.groupby("tweet_id").posted_at.first()
    posts = posted[(posted > started) & (posted < cutoff)].index
    if len(posts) == 0:
        print("No recorded post is old enough for this dump yet. Rerun once the dump covers the recording.")
        return
    v = views[views.tweet_id.isin(posts)]
    runs = pf.replay(v, [p["b"], p["c"], p["tau_post"]])
    seen = set(runs.tweet_id.astype(str))
    labelled = {str(t) for t in posts} & seen
    hits = labelled & helpful
    print(f"{len(labelled):,} posts seen before 24 hours, {len(hits)} with a helpful note ({len(hits) / len(labelled):.1%})")

    v48 = {str(t): ev.views_at(s.age_h.to_numpy(), s.impressions.to_numpy(dtype=float), ev.TARGET_AGE_H) for t, s in v.groupby("tweet_id")}

    def let_through(column: str, floor: float) -> dict:
        first = first_admissions(runs, column, floor)
        ids = set(first.index)
        kept_hits = ids & hits
        to_come = [v48[t] - first.loc[t, "impressions"] for t in kept_hits if v48.get(t) is not None]
        return {"all": len(ids & labelled) / len(labelled), "helpful": len(kept_hits) / max(len(hits), 1),
                "age": float(first.loc[list(kept_hits), "age"].median()) if kept_hits else float("nan"),
                "views_left": float(np.sum(to_come)), "ids": kept_hits}

    old, new = let_through("velocity", pf.VELOCITY_FLOOR_PER_H), let_through("predicted", VIEWS_FLOOR)
    print("\nRule                          let through   of helpful-note posts   median age then   their views still to come then")
    for name, r in [("velocity >= 15,000/h", old), (f"predicted to come >= {VIEWS_FLOOR:,}", new)]:
        print(f"  {name:28s} {r['all']:10.1%}   {r['helpful']:20.1%}   {r['age']:12.1f} h   {r['views_left'] / 1e6:10.1f} M")
    print(f"  helpful-note posts only the old rule lets through: {len(old['ids'] - new['ids'])}, only the new one: {len(new['ids'] - old['ids'])}, both: {len(old['ids'] & new['ids'])}, neither: {len(hits - old['ids'] - new['ids'])}")

    # A prediction swings with each 10-minute gain, so over a post's life more
    # posts cross a floor at some run than the per-run counts suggest. Compare
    # the rules also at the same share of posts let through.
    grid = np.geomspace(20_000, 2_000_000, 60)
    shares = [let_through("predicted", f)["all"] for f in grid]
    matched = float(grid[int(np.argmin(np.abs(np.array(shares) - old["all"])))])
    m = let_through("predicted", matched)
    print(f"  at the same share of posts let through ({m['all']:.1%}), the new rule's floor is {matched:,.0f} and it lets through {m['helpful']:.1%} of helpful-note posts")

    write_details(hits, runs, notes, v48)

    print("\nOther floors: share of all posts let through, share of helpful-note posts let through")
    for column, floors, unit in [("velocity", VELOCITY_FLOORS, "views/h"), ("predicted", VIEWS_FLOORS, "views to come")]:
        for f in floors:
            r = let_through(column, f)
            print(f"  {column:9s} >= {f:>9,} {unit:13s}  all {r['all']:6.1%}   helpful {r['helpful']:6.1%}")


if __name__ == "__main__":
    main()
