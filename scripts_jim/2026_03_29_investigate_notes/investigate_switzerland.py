"""Investigate the Switzerland arms export note and its pipeline history."""

import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

TWEET_ID = "2032822036821573740"

runs = sb.table("pipeline_runs").select("*").eq("tweet_id", TWEET_ID).execute().data
print(f"=== {len(runs)} pipeline runs for tweet {TWEET_ID} ===\n")

for r in sorted(runs, key=lambda x: x["created_at"]):
    print(f"Bot: {r['bot_id']}")
    print(f"  Outcome: {r['outcome']} ({r.get('outcome_reason') or r.get('error_message') or ''})")
    print(f"  Stage: {r['final_stage']}")
    print(f"  Time: {r['created_at']}")
    print(f"  Tweet: {r['tweet_text']}")
    print(f"  Impressions: {r.get('tweet_impressions')}, Likes: {r.get('tweet_likes')}")
    if r.get("note_id"):
        print(f"  Note ID: {r['note_id']}")
    if r.get("search_results"):
        print(f"  Search results: {r['search_results']}")
    if r.get("note_text"):
        print(f"  Note text: {r['note_text']}")
    if r.get("check_reasoning"):
        print(f"  Check: {r['check_reasoning']}")
    print()

# Canonical info
canonical = sb.table("canonical_note_information").select("*").eq("tweet_id", TWEET_ID).execute().data
print(f"=== {len(canonical)} canonical notes ===\n")
for c in canonical:
    print(f"Note ID: {c['note_id']}")
    print(f"  Bot: {c.get('bot_name')}")
    print(f"  Status: {c['cn_status']}")
    print(f"  Views: {c.get('view_count')}")
    print(f"  Decided by: {c.get('current_decided_by')}")
    print(f"  Ratings: {c.get('rating_count')} (helpful: {c.get('helpful_count')}, not helpful: {c.get('not_helpful_count')})")
    print(f"  Classification: {c.get('classification')}")
    print()
