"""What raw material exists for a floor-policy simulation?

1. feed_tweets: when did full-feed captures run (first_seen_at by day), how many rows.
2. pipeline_runs: feed_size pick coverage over time for regular-feed notes.
"""

from collections import Counter

from supabase_rest import fetch_all, rest_get


def main():
    head = rest_get("feed_tweets", {"select": "tweet_id", "limit": "1"})
    if not head:
        print("feed_tweets: EMPTY")
    else:
        rows = fetch_all(
            "feed_tweets",
            {"select": "tweet_id,first_seen_at,last_seen_at"},
            order_col="tweet_id",
        )
        print(f"feed_tweets: {len(rows)} rows")
        first_days = Counter(r["first_seen_at"][:10] for r in rows)
        last_days = Counter(r["last_seen_at"][:10] for r in rows)
        print("first_seen_at by day:")
        for day in sorted(first_days):
            print(f"  {day}: {first_days[day]}")
        print("last_seen_at by day (re-sightings):")
        for day in sorted(last_days):
            print(f"  {day}: {last_days[day]}")

    runs = fetch_all(
        "pipeline_runs",
        {
            "select": "id,created_at,ab_test_picks->>feed_size",
            "outcome": "in.(submitted,candidate)",
            "created_at": "gte.2026-05-01",
        },
        order_col="id",
    )
    print(f"\npipeline_runs submitted+candidate since May: {len(runs)}")
    by_month_size = Counter((r["created_at"][:7], r.get("feed_size") or "MISSING") for r in runs)
    for (month, size), n in sorted(by_month_size.items()):
        print(f"  {month} {size}: {n}")


if __name__ == "__main__":
    main()
