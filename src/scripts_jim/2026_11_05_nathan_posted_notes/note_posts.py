"""Which of Nathan's posts on X is about which note.

Most posts link to the note itself (?note=<id>). A few link only to the post
or page the note is on, but their picture shows one note, so the note is
named here by hand. Posts about a whole article with several notes are left
out, because they single out no note.
"""

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
NOTE_ID_IN_URL = re.compile(r"[?&]note=([0-9a-f-]{36})")

# Post id -> the note its picture shows. Found by reading the picture and
# searching the note text on 2026-11-05.
NOTES_SHOWN_IN_PICTURES = {
    # Andy Masley, China funding article. The picture shows the "$2 billion+" note.
    "2102070135754572075": "51e5b26d-bdb9-4ba5-bd1b-9dd8fb0199c2",
    # Joe Rogan #2553 with Andrew Huberman. The picture shows the hypothalamus note.
    "2105030359465542024": "f97f6230-6801-4cbc-8c74-7b1fac6160a4",
}


def notes_in_post(post: dict) -> list[str]:
    linked = [match.group(1) for link in post["links"] if (match := NOTE_ID_IN_URL.search(link or ""))]
    shown = NOTES_SHOWN_IN_PICTURES.get(post["url"].rsplit("/", 1)[1])
    return linked + ([shown] if shown else [])


def first_post_per_note() -> dict[str, dict]:
    """Each posted note with the first post about it."""
    posts = sorted(json.loads((HERE / "x_posts.json").read_text()), key=lambda post: post["created_at"])
    first: dict[str, dict] = {}
    for post in posts:
        for note_id in notes_in_post(post):
            first.setdefault(note_id, post)
    return first
