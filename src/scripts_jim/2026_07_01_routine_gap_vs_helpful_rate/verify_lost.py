"""Spot-check the lost_to_competitor labeling against the dashboard rule (read-only)."""
from analyze import (HELPFUL, NOT_HELPFUL, UUID_ZERO, WINDOW_START,
                     fetch_paginated, load_lost_note_ids, sb)

lost_ids = load_lost_note_ids()
print(f"distinct our_note_ids with a helpful competitor: {len(lost_ids)}")

# 4 of our submitted notes that we labeled lost -> show their cn_status + competitor rows
sample = list(lost_ids)[:4]
for nid in sample:
    note = sb.table("notes").select("note_id, cn_status, submitted_at").eq("note_id", nid).execute().data
    comps = sb.table("competing_notes").select("note_id, current_status") \
        .eq("our_note_id", nid).execute().data
    cn = note[0]["cn_status"] if note else "(note row missing)"
    has_helpful = any(c["current_status"] == HELPFUL for c in comps)
    not_terminal = cn not in (HELPFUL, NOT_HELPFUL)
    statuses = [c["current_status"] for c in comps]
    print(f"\nnote {nid}")
    print(f"  our cn_status        = {cn}   (not helpful/unhelpful? {not_terminal})")
    print(f"  competitor statuses  = {statuses}   (>=1 helpful? {has_helpful})")
    print(f"  -> correctly lost_to_competitor: {not_terminal and has_helpful}")

# a labeled-helpful note should NOT be in lost_ids (we won, not lost)
helpful_notes = fetch_paginated("notes", "note_id, cn_status", "note_id",
                                lambda q: q.eq("cn_status", HELPFUL).gte("submitted_at", WINDOW_START), "")
overlap = [n["note_id"] for n in helpful_notes if n["note_id"] in lost_ids]
print(f"\nhelpful notes also flagged lost (should be 0, helpful wins priority): {len(overlap)}")
