"""
Fetch eligible posts from X Community Notes API and plot a histogram of post age (recency in minutes).
Requires: pip install requests requests-oauthlib matplotlib
Reads OAuth credentials from .env.local (same keys as the main project).
"""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import matplotlib.pyplot as plt
import requests
from requests_oauthlib import OAuth1

# Load env vars from .env.local
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / ".env"


def load_env(path: Path) -> None:
    if not path.exists():
        print(f"Warning: {path} not found, relying on environment variables")
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        if key and value:
            os.environ.setdefault(key.strip(), value.strip())


load_env(ENV_FILE)

API_KEY = os.environ["X_API_KEY"]
API_KEY_SECRET = os.environ["X_API_KEY_SECRET"]
ACCESS_TOKEN = os.environ["X_ACCESS_TOKEN"]
ACCESS_TOKEN_SECRET = os.environ["X_ACCESS_TOKEN_SECRET"]

URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes"
MAX_RESULTS_PER_PAGE = 100
MAX_PAGES = 10
FEED_SIZE = sys.argv[1] if len(sys.argv) > 1 else "small"


def fetch_all_eligible_posts() -> list[dict]:
    auth = OAuth1(API_KEY, API_KEY_SECRET, ACCESS_TOKEN, ACCESS_TOKEN_SECRET)
    all_posts = []
    next_token = None

    for page in range(MAX_PAGES):
        params = {
            "test_mode": "false",
            "max_results": str(MAX_RESULTS_PER_PAGE),
            "tweet.fields": "created_at",
            "post_selection": f"feed_size: {FEED_SIZE}, feed_lang: en",
        }
        if next_token:
            params["pagination_token"] = next_token

        resp = requests.get(URL, params=params, auth=auth, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        posts = data.get("data", [])
        all_posts.extend(posts)
        print(f"Page {page + 1}: fetched {len(posts)} posts (total: {len(all_posts)})")

        next_token = data.get("meta", {}).get("next_token")
        if not next_token:
            break

    return all_posts


MAX_AGE_MINUTES = 24 * 60  # 24 hours


def compute_age_minutes(posts: list[dict]) -> list[float]:
    now = datetime.now(timezone.utc)
    ages = []
    for post in posts:
        created = datetime.fromisoformat(post["created_at"].replace("Z", "+00:00"))
        age_minutes = (now - created).total_seconds() / 60
        if age_minutes <= MAX_AGE_MINUTES:
            ages.append(age_minutes)
    ages.sort()
    return ages


def plot_histogram(ages: list[float]) -> None:
    plt.figure(figsize=(12, 6))
    plt.hist(ages, bins=50, edgecolor="black", alpha=0.7)
    plt.xlabel("Post Age (minutes)")
    plt.ylabel("Number of Posts")
    plt.title(f"Eligible Posts by Recency — Last 24h ({len(ages)} posts, feed_size={FEED_SIZE})")
    plt.tight_layout()

    output_path = Path(__file__).parent / "eligible_posts_recency.png"
    plt.savefig(output_path, dpi=150)
    print(f"Saved plot to {output_path}")
    plt.show()


def main() -> None:
    print(f"Fetching eligible posts (feed_size={FEED_SIZE})...")
    posts = fetch_all_eligible_posts()
    if not posts:
        print("No posts returned.")
        return

    ages = compute_age_minutes(posts)
    print(f"\nTotal posts: {len(ages)}")
    print(f"Oldest: {ages[-1]:.0f} min ({ages[-1]/60:.1f} hrs)")
    print(f"Newest: {ages[0]:.0f} min ({ages[0]/60:.1f} hrs)")
    print(f"Median: {ages[len(ages)//2]:.0f} min")

    plot_histogram(ages)


if __name__ == "__main__":
    main()
