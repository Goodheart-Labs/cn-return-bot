"""Is the new feed-supply archive writing rows? Look at everything first-seen
after the PR merge and sanity-check the frozen columns."""

from collections import Counter
from datetime import datetime, timezone

from supabase_rest import fetch_all

MERGE_TIME = "2026-08-07T11:29:00Z"
VELOCITY_MIN_AGE_HOURS = 0.25


def main():
    rows = fetch_all(
        "feed_tweets",
        {
            "select": "tweet_id,posted_at,first_seen_at,first_seen_impressions,first_seen_feed_size,impressions",
            "first_seen_at": f"gte.{MERGE_TIME}",
        },
        order_col="tweet_id",
    )
    print(f"rows first seen since merge: {len(rows)}")
    if not rows:
        return

    by_tier = Counter(r["first_seen_feed_size"] for r in rows)
    print(f"by tier: {dict(by_tier)}")
    by_batch = Counter(r["first_seen_at"][:16] for r in rows)
    print("rows per archive batch (first_seen_at, minute):")
    for batch in sorted(by_batch):
        print(f"  {batch}: {by_batch[batch]}")

    null_imp = sum(1 for r in rows if r["first_seen_impressions"] is None)
    frozen_matches_current = sum(1 for r in rows if r["first_seen_impressions"] == r["impressions"])
    print(f"null first_seen_impressions: {null_imp}")
    print(f"first_seen_impressions == impressions (expected while no capture re-sights): {frozen_matches_current}/{len(rows)}")

    print("\nvelocity distribution at first sight (impressions/h):")
    velocities = []
    for r in rows:
        if r["first_seen_impressions"] is None or not r["posted_at"]:
            continue
        age_h = (
            datetime.fromisoformat(r["first_seen_at"].replace("Z", "+00:00"))
            - datetime.fromisoformat(r["posted_at"].replace("Z", "+00:00"))
        ).total_seconds() / 3600
        velocities.append((r["first_seen_impressions"] / max(age_h, VELOCITY_MIN_AGE_HOURS), r["first_seen_feed_size"]))
    velocities.sort()
    for q in (0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0):
        idx = min(int(q * len(velocities)), len(velocities) - 1)
        print(f"  p{int(q*100):3d}: {velocities[idx][0]:>12,.0f}/h")
    below_floor = sum(1 for v, _ in velocities if v < 15_000)
    print(f"below the 15k/h floor: {below_floor}/{len(velocities)} — confirms below-floor posts are archived")


if __name__ == "__main__":
    main()
