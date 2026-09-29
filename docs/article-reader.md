# Article reader

Open `/read/?url=<encoded article URL>` (or `/cn-return-bot/notes/read/` on
GitHub Pages). The separate Vite HTML entry reads an existing item through the
shared public queries and renders its stored `full_text`. It does not fetch
articles or run checks. Missing items and paragraph-only checks link to the
original instead of presenting a full article.

The masthead shows the item title, source host and publication date. A prominent
attribution box and an end-of-article link point back to the original. Source
title/date lines remain intact; only explicit Markdown headings become headings.

Notes attach to uniquely matching passages, using surrounding paragraphs to
resolve repeated quotes. Unmatched notes remain accessible. Readers can add a
note to a passage or highlight words to annotate them; shared components handle
voting, sources, improvements and deletion.

Optional `&full=<encoded second URL>` adds a closed “Read the full text” section.
Opening it loads a second article with independent passages and note writing.
Shared passage/note links retain both source URLs and identify the article.

Public claims are readable under migration 050’s `anon_read_claims` policy.
Successful pipeline claims (`note` or `no_note`) count as checked; pending,
skipped, failed and user-authored claims do not. `no_note` claims without a
visible note get a quiet marker using the same passage matching as notes.

Checks: `bun test src/everything-web`, `./node_modules/.bin/tsc --noEmit`, and
`bun run build-everything-web`.
