# /// script
# requires-python = ">=3.10"
# dependencies = ["python-dotenv", "requests"]
# ///
"""Distribution of everything-pipeline costs per post.

Reads everything_pipeline_runs.cost (USD per checkClaim run, migration 068),
sums runs up to per-item ("per-post") costs via everything_claims.item_id, and
prints the distribution: typical cost, spread, outliers, and a daily-spend
estimate. Purpose: pick a sensible daily budget (Jim is considering 50 EUR/day).

Run from the workspace root:
    uv run src/scripts_jim/2026_08_15_pipeline_costs/main.py           # prod
    uv run src/scripts_jim/2026_08_15_pipeline_costs/main.py --local   # local Supabase
"""

import argparse
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values

ENV_FILE = Path(__file__).resolve().parents[3] / ".env"

# PostgREST caps responses at 1000 rows, so every fetch pages with Range headers.
PAGE_SIZE = 1000

# Rough conversion for the budget comparison only; update when it drifts.
USD_PER_EUR = 1.17

DAILY_BUDGET_EUR = 50

# Days with at least one run that we average over for the daily-spend estimate.
RECENT_DAYS_WINDOW = 14

OUTLIER_TOP_N = 10

HISTOGRAM_WIDTH = 50


def load_credentials(local: bool) -> tuple[str, str]:
    env = dotenv_values(ENV_FILE)
    prefix = "LOCAL_" if local else ""
    url = env.get(f"{prefix}SUPABASE_URL")
    key = env.get(f"{prefix}SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit(f"Missing {prefix}SUPABASE_URL / {prefix}SUPABASE_SERVICE_KEY in {ENV_FILE}")
    return url, key


def fetch_all(url: str, key: str, table: str, select: str) -> list[dict]:
    rows: list[dict] = []
    while True:
        response = requests.get(
            f"{url}/rest/v1/{table}",
            params={"select": select},
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Range": f"{len(rows)}-{len(rows) + PAGE_SIZE - 1}",
            },
            timeout=60,
        )
        response.raise_for_status()
        page = response.json()
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows


def sum_costs_per_item(
    runs: list[dict], claim_to_item: dict[str, str]
) -> tuple[dict[str, float], int]:
    """Returns (item_id -> total USD, number of runs that had no cost recorded)."""
    per_item: dict[str, float] = defaultdict(float)
    runs_without_cost = 0
    for run in runs:
        if run["cost"] is None:
            runs_without_cost += 1
            continue
        item_id = claim_to_item.get(run["claim_id"])
        if item_id is not None:
            per_item[item_id] += float(run["cost"])
    return dict(per_item), runs_without_cost


def sum_costs_per_day(runs: list[dict]) -> dict[str, float]:
    per_day: dict[str, float] = defaultdict(float)
    for run in runs:
        if run["cost"] is not None:
            per_day[run["created_at"][:10]] += float(run["cost"])
    return dict(per_day)


def percentile(sorted_values: list[float], fraction: float) -> float:
    index = min(int(fraction * len(sorted_values)), len(sorted_values) - 1)
    return sorted_values[index]


def print_distribution(costs: list[float], unit_label: str) -> None:
    ordered = sorted(costs)
    print(f"  count   {len(ordered)}")
    print(f"  total   ${sum(ordered):,.2f}")
    print(f"  mean    ${statistics.mean(ordered):.2f}")
    print(f"  median  ${statistics.median(ordered):.2f}")
    for fraction in (0.10, 0.25, 0.75, 0.90, 0.95, 0.99):
        print(f"  p{int(fraction * 100):<5}  ${percentile(ordered, fraction):.2f}")
    print(f"  min     ${ordered[0]:.2f}")
    print(f"  max     ${ordered[-1]:.2f}")
    if len(ordered) > 1:
        print(f"  stdev   ${statistics.stdev(ordered):.2f}")
    print_histogram(ordered, unit_label)


def print_histogram(ordered: list[float], unit_label: str, buckets: int = 12) -> None:
    low, high = ordered[0], ordered[-1]
    if high == low:
        return
    width = (high - low) / buckets
    counts = [0] * buckets
    for value in ordered:
        counts[min(int((value - low) / width), buckets - 1)] += 1
    print(f"\n  {unit_label} histogram:")
    for i, count in enumerate(counts):
        bar = "#" * round(count / max(counts) * HISTOGRAM_WIDTH)
        print(f"  ${low + i * width:7.2f}–${low + (i + 1) * width:7.2f}  {count:5d}  {bar}")


def print_outliers(per_item: dict[str, float], item_names: dict[str, str]) -> None:
    print(f"\nTop {OUTLIER_TOP_N} most expensive posts:")
    ranked = sorted(per_item.items(), key=lambda pair: pair[1], reverse=True)
    for item_id, cost in ranked[:OUTLIER_TOP_N]:
        print(f"  ${cost:8.2f}  {item_names.get(item_id, item_id)}")


def print_daily_spend(per_day: dict[str, float]) -> None:
    budget_usd = DAILY_BUDGET_EUR * USD_PER_EUR
    print(f"\nDaily spend (last {RECENT_DAYS_WINDOW} calendar days with runs):")
    recent = sorted(per_day.items())[-RECENT_DAYS_WINDOW:]
    for day, spend in recent:
        marker = "  <-- over budget" if spend > budget_usd else ""
        print(f"  {day}  ${spend:8.2f}{marker}")
    average = statistics.mean(spend for _, spend in recent)
    print(f"\n  average over those days: ${average:.2f}/day")
    print(
        f"  proposed budget: {DAILY_BUDGET_EUR} EUR/day = ${budget_usd:.2f}/day"
        f" at {USD_PER_EUR} USD/EUR"
    )
    print(f"  headroom vs average: {budget_usd / average:.1f}x" if average > 0 else "")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local", action="store_true", help="use the local Supabase stack")
    args = parser.parse_args()

    url, key = load_credentials(args.local)
    print(f"Backend: {url}\n")

    runs = fetch_all(url, key, "everything_pipeline_runs", "claim_id,cost,created_at")
    claims = fetch_all(url, key, "everything_claims", "id,item_id")
    items = fetch_all(url, key, "everything_items", "id,title")

    claim_to_item = {claim["id"]: claim["item_id"] for claim in claims}
    item_names = {item["id"]: item["title"] or item["id"] for item in items}

    per_item, runs_without_cost = sum_costs_per_item(runs, claim_to_item)
    if not per_item:
        sys.exit("No runs with cost data found.")
    if runs_without_cost:
        print(f"Note: {runs_without_cost} of {len(runs)} runs have no cost recorded.\n")

    run_costs = [float(run["cost"]) for run in runs if run["cost"] is not None]
    print(f"Per-run cost (one fact-checked claim), {len(run_costs)} runs:")
    print_distribution(run_costs, "per-run")

    print(f"\nPer-post cost (all runs of an item summed), {len(per_item)} posts:")
    print_distribution(list(per_item.values()), "per-post")

    print_outliers(per_item, item_names)
    print_daily_spend(sum_costs_per_day(runs))


if __name__ == "__main__":
    main()
