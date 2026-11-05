"""Step 4: marks every note Nathan posted on X as posted, with the tweet's address and time.

Reads x_posts.json from step 3. A note that was posted twice gets its first
post. Without --apply it only prints what it would change.
  uv run --no-project --with supabase --with python-dotenv python src/scripts_jim/2026_11_05_nathan_posted_notes/04_mark_posted.py [--apply]
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from note_posts import first_post_per_note

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[2]
MARKS_TABLE = "everything_note_x_marks"



def planned_change(existing: dict | None, post: dict) -> dict | None:
    """The row to write, or None when the mark is already complete."""
    if existing and existing["mark"] == "posted" and existing.get("tweet_url"):
        return None
    if existing and existing["mark"] == "wont_post":
        return None
    return {"mark": "posted", "published_at": post["created_at"], "tweet_url": post["url"]}


def main() -> None:
    apply = "--apply" in sys.argv
    load_dotenv(PROJECT_ROOT / ".env")
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    marks = {row["note_id"]: row for row in db.table(MARKS_TABLE).select("*").execute().data}
    for note_id, post in first_post_per_note().items():
        existing = marks.get(note_id)
        change = planned_change(existing, post)
        if change is None:
            continue
        print(f"{note_id}: {(existing or {}).get('mark')} -> posted, {post['url']}")
        if not apply:
            continue
        if existing:
            db.table(MARKS_TABLE).update(change).eq("note_id", note_id).execute()
        else:
            db.table(MARKS_TABLE).insert({"note_id": note_id, **change}).execute()
    if not apply:
        print("dry run: nothing written. Pass --apply to write.")


if __name__ == "__main__":
    main()
