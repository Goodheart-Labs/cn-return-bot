"""Step 7: the markdown list of all of Nathan's posts about Common Notes, for the
LessWrong draft. Newest first. A post about one note shows that note's text;
any other post shows its own text. Replies count only when the tagged account
wrote them to Nathan. Writes draft_list.md.
  python3 src/scripts_jim/2026_11_05_nathan_posted_notes/07_draft_list.py"""

import json
from pathlib import Path

from note_posts import notes_in_post

HERE = Path(__file__).resolve().parent
NATHAN_MENTION = "@nathanpmyoung"
LOCAL_PICTURES = "http://localhost:8005/"


def one_line(text: str) -> str:
    return " ".join(text.split())


def replies_to_nathan(post: dict) -> list[dict]:
    return [reply for reply in post["tagged_replies"] if one_line(reply["text"]).lower().startswith(NATHAN_MENTION)]


def describe_replies(post: dict) -> str:
    replies = sorted(replies_to_nathan(post), key=lambda reply: reply["created_at"])
    if not replies:
        return "Reply from the tagged person: none."
    parts = []
    for reply in replies:
        when = "before this post" if reply["created_at"] < post["created_at"] else "after"
        parts.append(f'"{one_line(reply["text"])}" ({when}, {reply["url"]})')
    return "Replies from the tagged person: " + " ".join(parts)


def entry(post: dict, notes: dict[str, dict]) -> str:
    tagged = ", ".join(f"@{handle}" for handle in post["mentioned"]) or "nobody"
    head = f"**{post['created_at'][:10]}**, tags {tagged}. {post['url']}"
    note_ids = notes_in_post(post)
    if note_ids:
        lines = [f"Note: {one_line(notes.get(note_id, {}).get('note') or note_id)}" for note_id in note_ids]
    else:
        lines = [f"Post text (about no single note): {one_line(post['text'])}"]
    return "\n".join([f"- {head}", *(f"  - {line}" for line in lines), f"  - {describe_replies(post)}"])


def main() -> None:
    posts = sorted(json.loads((HERE / "x_posts.json").read_text()), key=lambda post: post["created_at"], reverse=True)
    notes = {row["note_id"]: row for row in json.loads((HERE / "candidates.json").read_text())}
    notes.update(json.loads((HERE / "extra_notes.json").read_text()))
    about_a_note = sum(1 for post in posts if notes_in_post(post))
    intro = (f"All {len(posts)} posts Nathan wrote about Common Notes since August 2026. {about_a_note} are about one note, "
             f"and those notes are marked as posted in our database. Pictures of the notes: open {LOCAL_PICTURES} on the Mac and drag them in.")
    body = "\n".join(entry(post, notes) for post in posts)
    (HERE / "draft_list.md").write_text(f"+++ Every post Nathan made about Common Notes (Claude's list, for you to filter)\n{intro}\n\n{body}\n+++\n")
    print(f"{len(posts)} posts, {about_a_note} about one note")


if __name__ == "__main__":
    main()
