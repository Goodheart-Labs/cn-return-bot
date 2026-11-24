"""Step 1: notes whose link people opened, as candidates for "Nathan posted this on X".

A note's link is its project page with ?note=<id>. Nathan's tweets link there,
so opens by non-admins are the best sign that a note went out. Read-only.
Writes candidates.json next to this file.

  uv run --no-project --with supabase --with python-dotenv python src/scripts_jim/2026_11_05_nathan_posted_notes/01_candidates.py
"""

import json
import os
import re
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[2]
PAGE_SIZE = 1000
NOTE_ID_IN_URL = re.compile(r"[?&]note=([0-9a-fA-F-]{36})")


def fetch_all(query_builder) -> list[dict]:
    rows, start = [], 0
    while True:
        page = query_builder().range(start, start + PAGE_SIZE - 1).execute().data
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE


def admin_user_ids(db) -> set[str]:
    admin_emails = {row["email"].lower() for row in db.table("everything_admins").select("email").execute().data}
    users = db.auth.admin.list_users(per_page=1000)
    return {user.id for user in users if (user.email or "").lower() in admin_emails}


def note_opens(db, admins: set[str]) -> dict[str, dict]:
    events = fetch_all(lambda: db.table("everything_events").select("created_at, device_id, user_id, props")
                       .eq("event", "pageview").ilike("props->>url", "%note=%").order("created_at"))
    opens: dict[str, dict] = defaultdict(lambda: {"opens": 0, "devices": set(), "first_open": None})
    for event in events:
        if event["user_id"] in admins:
            continue
        match = NOTE_ID_IN_URL.search(event["props"].get("url", ""))
        if not match:
            continue
        entry = opens[match.group(1).lower()]
        entry["opens"] += 1
        entry["devices"].add(event["device_id"])
        entry["first_open"] = entry["first_open"] or event["created_at"]
    return opens


def note_details(db, note_ids: list[str]) -> dict[str, dict]:
    details = {}
    for start in range(0, len(note_ids), 100):
        batch = note_ids[start:start + 100]
        rows = (db.table("everything_notes")
                .select("id, note, claim:everything_claims(item:everything_items(title, url, project:everything_projects(name, slug, x_handle)))")
                .in_("id", batch).execute().data)
        for row in rows:
            claim = row.get("claim") or {}
            item = claim.get("item") or {}
            project = item.get("project") or {}
            details[row["id"]] = {
                "note": row["note"], "item_title": item.get("title"), "item_url": item.get("url"),
                "creator": project.get("name"), "slug": project.get("slug"), "x_handle": project.get("x_handle"),
            }
    return details


def main() -> None:
    load_dotenv(PROJECT_ROOT / ".env")
    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    opens = note_opens(db, admin_user_ids(db))
    marks = {row["note_id"]: row for row in db.table("everything_note_x_marks").select("*").execute().data}
    details = note_details(db, list(opens))
    candidates = []
    for note_id, entry in sorted(opens.items(), key=lambda item: -len(item[1]["devices"])):
        candidates.append({
            "note_id": note_id, "opens": entry["opens"], "devices": len(entry["devices"]), "first_open": entry["first_open"],
            "x_mark": marks.get(note_id), **details.get(note_id, {}),
        })
    (HERE / "candidates.json").write_text(json.dumps(candidates, indent=1))
    print(f"{len(candidates)} notes opened by non-admins; {sum(1 for c in candidates if c['x_mark'])} already have an X mark")
    for c in candidates:
        mark = (c["x_mark"] or {}).get("mark")
        print(f"{c['devices']:>3} devices {c['opens']:>4} opens  first {c['first_open'][:10]}  {c.get('slug')!s:<22} mark={mark!s:<9} {c['note_id']}")


if __name__ == "__main__":
    main()
