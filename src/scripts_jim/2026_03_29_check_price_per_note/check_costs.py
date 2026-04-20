"""Check OpenRouter spend vs notes created to get cost-per-note."""

import json
import os
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
OPENROUTER_MGMT_KEY = os.environ["OPENROUTER_MGMT_KEY"]
PROD_KEY_NAME = "ai-community-note-writer-2"


def openrouter_keys():
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/keys",
        headers={"Authorization": f"Bearer {OPENROUTER_MGMT_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())["data"]


def supabase_count(table, filters=None):
    """Count rows via Supabase REST API HEAD request."""
    params = {"select": "*"}
    if filters:
        params.update(filters)
    url = f"{SUPABASE_URL}/rest/v1/{table}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url, method="HEAD",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "count=exact",
        },
    )
    with urllib.request.urlopen(req) as r:
        count = r.headers.get("content-range", "")
        return int(count.split("/")[1]) if "/" in count else 0


def main():
    # --- OpenRouter spend ---
    keys = openrouter_keys()
    prod = next(k for k in keys if k["name"] == PROD_KEY_NAME)

    print("=" * 60)
    print(f"OpenRouter key: {PROD_KEY_NAME}")
    print(f"  Weekly spend:  ${prod['usage_weekly']:.2f}")
    print(f"  Monthly spend: ${prod['usage_monthly']:.2f}")
    print(f"  All-time:      ${prod['usage']:.2f}")
    print()

    # --- Notes submitted ---
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    notes_week = supabase_count("notes", {"submitted_at": f"gte.{week_ago}"})
    notes_month = supabase_count("notes", {"submitted_at": f"gte.{month_start}"})
    notes_total = supabase_count("notes")

    # --- Pipeline runs (all tweets processed, not just submitted) ---
    runs_week = supabase_count("pipeline_runs", {"created_at": f"gte.{week_ago}"})
    runs_month = supabase_count("pipeline_runs", {"created_at": f"gte.{month_start}"})

    print(f"Notes submitted (last 7 days):   {notes_week}")
    print(f"Notes submitted (this month):    {notes_month}")
    print(f"Notes submitted (all time):      {notes_total}")
    print()
    print(f"Pipeline runs (last 7 days):     {runs_week}")
    print(f"Pipeline runs (this month):      {runs_month}")
    print()

    # --- Cost per note ---
    print("=" * 60)
    print("COST PER NOTE")
    print("-" * 60)
    if notes_week > 0:
        print(f"  Last 7 days:  ${prod['usage_weekly'] / notes_week:.2f}/note  ({notes_week} notes, ${prod['usage_weekly']:.2f} spend)")
    else:
        print(f"  Last 7 days:  no notes submitted")
    if notes_month > 0:
        print(f"  This month:   ${prod['usage_monthly'] / notes_month:.2f}/note  ({notes_month} notes, ${prod['usage_monthly']:.2f} spend)")
    else:
        print(f"  This month:   no notes submitted")
    print()

    # --- Cost per pipeline run (includes rejected tweets) ---
    print("COST PER PIPELINE RUN (tweet evaluated)")
    print("-" * 60)
    if runs_week > 0:
        print(f"  Last 7 days:  ${prod['usage_weekly'] / runs_week:.2f}/run  ({runs_week} runs)")
    if runs_month > 0:
        print(f"  This month:   ${prod['usage_monthly'] / runs_month:.2f}/run  ({runs_month} runs)")
    print()

    # --- Monthly spend trend ---
    print("=" * 60)
    print("WHY IS THIS MONTH SO HIGH?")
    print("-" * 60)
    days_elapsed = (now - now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)).days or 1
    daily_rate = prod["usage_monthly"] / days_elapsed
    print(f"  Days elapsed this month: {days_elapsed}")
    print(f"  Daily burn rate:         ${daily_rate:.2f}/day")
    print(f"  Projected month total:   ${daily_rate * 30:.2f}")
    print(f"  Key created:             {prod.get('created_at', 'unknown')}")
    all_time_days = (now - datetime.fromisoformat(prod["created_at"])).days or 1
    prev_monthly_avg = (prod["usage"] - prod["usage_monthly"]) / max((all_time_days - days_elapsed) / 30, 1)
    print(f"  Prev months avg:         ~${prev_monthly_avg:.2f}/month")
    print(f"  This month vs prev avg:  {prod['usage_monthly'] / prev_monthly_avg:.1f}x" if prev_monthly_avg > 0 else "")


if __name__ == "__main__":
    main()
