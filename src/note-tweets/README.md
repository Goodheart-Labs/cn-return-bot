# Note tweets

Local Common Notes feed → tweet staging → Typefully. The feed includes every
voted note, Jim's GOO-217 list from the working tree's
`src/scripts_jim/2026_09_22_notes_factcheck/RESULTS.md`, and all notes on URLs in
`articles.json`. It ranks by the site's P(helpful), discounts the author's own
vote, and offers Jim/article/recent-third-helpful filters. Corrected sources are
collapsed separately.

Run from the repo root with the repo's dependencies installed. Configuration uses
`dotenv/config` and the root `.env` (existing environment variables take precedence):

- `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` for ranking.
- `VITE_SUPABASE_ANON_KEY` (or `SUPABASE_ANON_KEY`) for browser sign-in and voting;
  it must belong to the same Supabase project as `SUPABASE_URL`.
- `TYPEFULLY_API_KEY` and `TYPEFULLY_SOCIAL_SET_ID` for the server's Typefully sender.
  Set the social set for the account you intend to post from.

```bash
bun run note-tweets                         # refresh feed, then serve
bun run note-tweets-rank                    # refresh only
bun run note-tweets-rank https://example.com/article  # also add an article
bun run src/note-tweets/server.ts            # serve an existing feed
bun test src/note-tweets                     # offline tests
```

Open http://localhost:8003; this shares the Common Notes dev port, so stop that
server first. X sign-in requires this origin in the Supabase OAuth redirect
allow-list. The server binds to loopback. Playwright uses its bundled Chromium;
if missing, install it with `bunx playwright install chromium`.

Select notes and Stage them, then review `/staging`. Cards show screenshots from
commonnotes.net and editable tweet/reply text. Handles come from `handles.json`
(project slug, or hostname for web articles); missing handles display `@???`.
Copy text/image supports manual replies. “Send all” uploads images and creates
Typefully drafts **scheduled into the next free queue slots**, or posts immediately
when that option is selected. These are not unscheduled review-only drafts.
**Typefully has no draft DELETE API: remove mistakes in the Typefully app.**

Inputs are `handles.json` and `articles.json` (initially empty). Runtime state is
ignored under `.state/`: `staging.json`, `feed-data.json`, `ranked.html`, `shots/`,
and generated CSS/build inputs. Keep staging state to remember what was sent.
The CSS is built with the repo's Tailwind dependency and the original palette to
preserve these templates; scoring and article fragments import the shared code.
