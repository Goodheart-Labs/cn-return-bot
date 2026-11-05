"""Step 5: a local page with the picture of every note Nathan posted, newest
first, so Jim can drag the pictures into the LessWrong editor. Writes
images/index.html. Serve it with: mac-tunnel serve 8005 python3 -m http.server 8005 --bind 127.0.0.1 --directory <images dir>"""

import html
from pathlib import Path

from note_posts import first_post_per_note

HERE = Path(__file__).resolve().parent


def main() -> None:
    newest_first = sorted(first_post_per_note().items(), key=lambda item: item[1]["created_at"], reverse=True)
    sections = []
    for note_id, post in newest_first:
        tagged = ", ".join(f"@{handle}" for handle in post["mentioned"]) or "nobody"
        sections.append(
            f'<section><h2>{post["created_at"][:10]} · tags {html.escape(tagged)}</h2>'
            f'<p><a href="{post["url"]}">{post["url"]}</a></p>'
            f'<img src="{note_id}.png" alt="note {note_id}"></section>'
        )
    page = ("<!doctype html><meta charset=utf-8><title>Nathan's posted notes</title>"
            "<style>body{font:15px system-ui;max-width:700px;margin:24px auto;padding:0 16px}img{width:100%;border:1px solid #ddd}section{margin-bottom:40px}</style>"
            f"<h1>Notes Nathan posted on X ({len(sections)})</h1>" + "".join(sections))
    (HERE / "images" / "index.html").write_text(page)
    print(f"{len(sections)} notes on the page")


if __name__ == "__main__":
    main()
