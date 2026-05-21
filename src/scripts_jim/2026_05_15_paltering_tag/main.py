"""Trace the 'does not adress paltering' tag through the review dashboard tables.

Question: user tagged one note with this tag but clicking the pill returns
zero notes. Find:
  1. The catalog row.
  2. Every annotation that contains this tag (source, target_id).
  3. Whether the target_id corresponds to a canonical `notes` row (would be
     fetched + attached) or a missed-opportunity `competing_notes` row
     (would NOT be attached — known bug in buildDashboardItems).
"""

import os

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

TAG = "does not adress paltering"

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


def section(title: str) -> None:
    print(f"\n=== {title} ===")


section("Catalog row")
catalog = (
    supabase.table("review_dashboard_failure_modes")
    .select("*")
    .eq("name", TAG)
    .execute()
    .data
)
print(catalog)

section("Annotations referencing the tag")
# failure_modes is a text[] — `contains` does the array-contains check.
annotations = (
    supabase.table("review_dashboard_annotations")
    .select("*")
    .contains("failure_modes", [TAG])
    .execute()
    .data
)
print(f"{len(annotations)} annotation(s) found")
for a in annotations:
    print(
        f"  id={a['id']} source={a['source']} target_id={a['target_id']!r} "
        f"seen={a['seen']} comment={a.get('comment')!r}"
    )

section("Where does each target_id live?")
for a in annotations:
    tid = a["target_id"]
    if tid.startswith("missed:"):
        cn_id = tid.split(":", 1)[1]
        cn = (
            supabase.table("competing_notes")
            .select("note_id, tweet_id, current_status, our_note_id, pipeline_run_id")
            .eq("note_id", cn_id)
            .execute()
            .data
        )
        print(f"  {tid} → missed-opp competing_notes row: {cn}")
    else:
        # Look up in notes
        n = (
            supabase.table("notes")
            .select("note_id, tweet_id, cn_status, submitted_at")
            .eq("note_id", tid)
            .execute()
            .data
        )
        print(f"  {tid} → notes row: {n}")

section("Diagnosis")
if not annotations:
    print("No annotation exists. Either save failed or you're looking at the wrong DB.")
else:
    missed = [a for a in annotations if a["target_id"].startswith("missed:")]
    canonical = [a for a in annotations if not a["target_id"].startswith("missed:")]
    if missed:
        print(
            f"{len(missed)} annotation(s) target a missed-opportunity item. "
            "These are NEVER loaded by fetchDashboardData (it queries "
            "review_dashboard_annotations by canonical note_ids only) and even "
            "if loaded, buildDashboardItems doesn't attach annotations to "
            "missed-opportunity items. → the pill will always have count 0 "
            "and clicking it shows nothing."
        )
    if canonical:
        print(
            f"{len(canonical)} annotation(s) target a canonical note. If the "
            "pill count is 0 on the dashboard, the issue is elsewhere. If the "
            "count is >0, the failure-type filter is excluding the item."
        )
