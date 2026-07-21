# CLAUDE.md

Project context for Claude Code sessions.

## What this is

A bot that automatically writes Community Notes for X/Twitter posts. Runs on GitHub Actions every 15 minutes. Posts using X note writing API. There are several bots that are writing and then predicting the outcome of their writing.

## Strategic context

There are some ranked strategic cruxes (Mar 2026) in Claude's auto-memory covering counterfactual impact, scoring calibration, cap constraints, platform diversity, and whether to build beyond X.

## Goals
### Primary metrics

1. **Views of AI-written community notes**
   - Currently: ~13M views
   - Context: X displays ~10B views of community notes annually
   - Also aim for 10B views on TikTok/Meta

2. **Estimated misleading views suppressed**
   - Currently: ~1M views suppressed (suppression rate ~13%, likely higher if notes display earlier)
   - Context: Misleading views on X are perhaps ~100B/year
   - Aim: 1B reduced misleading views from this project

3. **Platform diversity**
   - Currently: AI-written community notes exist solely on X
   - Aim: Another comparable platform, or 10B non-X views/year

4. **Massive X success (notewriter views)**
   - Currently: ~1M views from our notewriter account
   - Aim: 1B views from our notewriters

## Tech stack

- TypeScript, Bun
- OpenRouter for LLM calls (uses Openrouter `anthropic/claude-opus-4.6` format, NOT Anthropic API format)
- Supabase for data storage
- Playwright for browser automation for scraping to get feedback on notes

## Key directories

- `src/pipeline/` - Core logic organized into subfolders:
  - `search/` - Context search (Perplexity, Grok)
  - `write/` - Note generation variants
  - `verify/` - Source verification
  - `score/` - Note scoring, ranking, evaluation filter
  - `llm/` - LLM client, xAI client, schemas
  - `media/` - Media analysis
  - `orchestration/` - processTweet, generateCandidates, submitCandidates
  - `utils/` - tweetLog, browserManager, parseStatusNoteUrl
- `src/bots/` - Bot configurations (opus-main, multi-search)
- `src/production/` - GitHub Actions entry points (runPipeline, updateNoteFeedback)
- `src/local/` - Local testing tools (tryoutNotes, runOnVideos, evaluateResults)
- `src/scraper/` - Notewriter page scraper
- `src/everything/` - "Community Notes on Everything" pipeline (see below)
- `src/everything-web/` - Public React SPA for everything-notes (GitHub Pages, realtime + anon voting)
- `src/review-dashboard/` - React dashboard for reviewing note failures
- `src/scripts_jim/` - Jim's investigation journal (Python, by date)
- `src/scripts_nathan/` - Nathan's investigation scripts (by date)
- `migrations/` - Supabase SQL migrations

## Common Notes ("Community Notes on Everything")

Queue-driven pipeline that writes notes on non-X content (YouTube, Substack) into the `everything_*` tables, displayed on a public GitHub Pages SPA (`/cn-return-bot/notes/`) grouped by **project** (a newsletter / podcast / site). Within a project each **item** — one episode / post / page — is the natural sub-group; the SPA's chip row filters by item (any project with ≥2 items-with-notes). Product name is "Common Notes"; internal names stay `everything_*` / `src/everything*`.

```bash
# One ingestion command. Everything lands under --project <slug> (created if new) as one item per document.
bun run everything-enqueue --project <slug> <url...>              # live YouTube video / Substack post / Substack profile (--latest N)
bun run everything-enqueue --project <slug> --doc [<url>] <file>  # local doc: <file> text is the body; optional <url> = source link (+ YouTube cues → timestamps)
bun run everything-enqueue --project <slug> --manifest <dir>      # batch a folder's README.md manifest into one item per page
bun run everything-worker                                         # drain the queue and exit
bun run commonnotes                                              # local FE on port 8003 against the PROD backend (.env.prod-backend, gitignored: prod URL + anon key)
bun run commonnotes-local                                       # local FE against the local Supabase (VITE_SUPABASE_* in root .env)
```

Ingestion is unified under `everything-enqueue` — the only front door. A **bare URL** is fetched by the worker. A **`--doc [<url>] <file>`** supplies the extraction body from a local `.md`/`.txt` file (the text is stored on the item at enqueue in `full_text`; the worker uses it instead of fetching). For a YouTube `<url>` the worker still fetches the video's cues so each claim's timestamp snaps onto them — this is how you fact-check from an author's clean published transcript rather than noisy auto-captions; any other `<url>` becomes the article's source link (text-anchored, no timestamps). With **no url** (`--doc <file>`) the item gets a synthetic `local:<slug>/<file>` key and renders no source link (`isSyntheticDocUrl` → `context_url` null). **`--manifest <dir>`** expands `README.md` rows (`Source: <base>` + `- [title](file.md) — \`/path\``) into a batch of `--doc` pairs. There is no separate importer — the old `import-files` / `import-dwarkesh` / `import-claims` scripts and the standalone `checkYoutubeClaims` podcast pipeline were removed; podcasts now go through `--doc <youtube-url> <transcript>`.

Pipeline: per claim it forces `bot=simple-bot, note_prefilter=off, search_claim=on`; search runs on Opus 4.8 (`simple_bot_search=opus48-native`), the writer on Sonnet 5 (`simple_bot_writer=sonnet5`), the source verifier on Gemini 3 Flash, non-claim-based (`verifier_claim_based=classic`, the single-call accept/reject flow) with `verifier_citations=on` (accepted sources carry a verbatim supporting quote + explanation). Confident-true claims skipped (`shouldFactCheck`). Substack images are fed inline to the Opus claim extractor, so a claim can rest on text, an image, or both (`context_quote` nullable, `image_urls` carries the images).

Data model (migration 050): `everything_projects → items → claims → notes`, plus `everything_votes`. Migration 050 also locks the anon role out of every other table (anon key is baked into the public site). Migration 053 dropped the one-note-per-claim constraint (a claim can hold the AI note plus user drafts); migration 055 dropped the old `everything_note_suggestions` table. Migration 056 moved a note's citations out of the `everything_notes.sources` jsonb column into a dedicated `everything_note_sources` table (`url, quote, explanation`), one row per supporting snippet. Migration 057 added `everything_claims.image_urls` (images a claim is grounded in) and made `context_quote` nullable (image-only claims carry no text excerpt). Each claim carries a `context_quote` (the highlighted span) and a wider `context_paragraph` (surrounding passage), both produced by the Opus extraction step. `everything_items.full_text` (migration 054) is the item's body text and is now persisted on ingest for every source (what the public write-note flow searches) — no backfill needed. Migration 058 added `everything_notes.improved_from_note_id` (an improvement's link to its original) + a trigger auto-casting the author's helpful vote on their own note. Migration 059 gave `everything_votes` a surrogate `id` and a `reasoning` column (the column is now unused — the UI posts comments instead of private reasoning), plus the private `everything_donations` ledger (`vote_id unique, charity, amount_usd`; own-rows RLS, no anon access). Migration 061 turned the donation ledger outcome-contingent: `amount_if_helpful` / `amount_if_not_helpful` (the pair frozen at vote time), with `amount_usd` now the settled amount (null until the note's rating locks in; old flat-$2 rows keep `amount_usd = 2`). Migration 063 added `everything_note_not_needed` (+ `_votes`, counter/self-vote triggers mirroring notes) and dropped the comments tables from migration 060 (`everything_comments` + `everything_comment_votes`, data discarded).

Auth & interaction:
- **Reading** is anonymous. **Voting** and **writing/improving notes** require login (magic link or X) — votes key on `auth.uid()` via RLS; counters via trigger.
- **Note actions** (inline on every note): **Suggest an improvement** posts your rewrite as your own `draft` note on the *same claim*, linked via `improved_from_note_id` — it renders as its own card with ↑/↓ jump-links to/from the original (no nesting, no replacement); **Share** copies a deep link; **Delete** (⋯ menu) shows only on notes you authored (RLS: delete own `draft` notes, migration 053).
- **Vote donations (log market scoring rule)**: every note vote — except on your own note — mints a donation with a **frozen outcome-contingent pair**: $X if the note settles rated helpful / $Y if not, computed at vote time from the note's running vote tally (prior p=0.35; a Helpful vote moves log-odds +0.4, Not-helpful −0.52, Somewhat 0; $5/nat, $1.50 base, score-drop clip 0.24 — preset S2, derivation in `src/scripts_jim/2026_07_17_donation_scoring/RESULTS.md`). Early consensus-shifting votes earn more (max $4.10); wrong-direction votes floor at $0.30; a voter whose settled total would be negative donates $0. The pair is upserted keyed to the vote (`unique(vote_id)`, re-votes refresh it, retracting cascades it away). The voter picks the charity *after* voting (GiveDirectly default; GiveWell / ACE / EA LTFF; choice remembered). The post-vote box is donation-only — no reasoning prompt (discussion is its own action on the note). The team settles + fulfils donations manually from the ledger once a note's rating locks in. UI: `VoteDonation.tsx`, libs `lib/donationScoring.ts` (formula), `lib/donations.ts` (`CHARITIES`, ledger writes).
- **Note not needed**: written via **Note not needed** in the note's action row (login required, ungated) — a flat free-text argument that the claim needs no note, keyed to the **claim** (`everything_note_not_needed`, migration 063), so the same list renders under every note on that exact text (original, improvements, manual notes). No nesting (`NoteNotNeeded.tsx`). Entries take the same three-way votes as notes (counter + author-self-vote triggers) but entry votes never mint donations. Entry ranking is by age, not votes.
- **Earnest gate**: user text paths — writing a note (WriteNoteModal), suggesting an improvement (but NOT "Note not needed" — that stays ungated) — go through the `supabase/functions/judge-note` edge function (LLM, earnest-vs-trolling, verdict-only — it stores nothing). The client posts only on an `accepted` verdict; rejected text is never written (WriteNoteModal judges *before* creating its claim, so no orphan claim). Needs `OPENROUTER_API_KEY`; `verify_jwt=false` (self-authorizes via `getUser`). Local: `supabase functions serve judge-note --env-file .env`. The gate is advisory (keeps the OpenRouter key server-side + filters the UI path); it is not RLS-enforced, so a crafted client could still insert directly.
- **Feed ranking**: every note is its own card (no per-claim promotion). Feed order in `App.tsx`: notes needing ratings first (oldest→newest), then locked-in helpful notes least→most helpful (best sit lowest), net-negative notes sink below a dotted divider, the worst collapse into a drawer. A just-voted note holds its exact slot for 6s (its ranking inputs freeze at vote time — `voteHolds` snapshots) so it doesn't teleport while you reconsider.
- X sign-in needs `TWITTER_CLIENT_ID` + `SUPABASE_AUTH_EXTERNAL_TWITTER_SECRET`. Magic links / OAuth redirect back to the origin the user signed in from (`emailRedirectTo: window.location.href`), but only if that origin is on the target project's redirect allow-list — otherwise Supabase silently falls back to the Site URL. Local project's list is in `supabase/config.toml` (localhost:8003/8004, `*.github.io`, commonnotes.net); the prod list is dashboard-only (Auth → URL Configuration) and must include the localhost origins to test sign-in locally against the prod backend.

Prod prerequisites (manual): run migrations (incl. 058–061; 060's realtime-publication line included); `supabase functions deploy judge-note` + `supabase secrets set OPENROUTER_API_KEY=…`; repo secret `SUPABASE_ANON_KEY`. In the prod project's dashboard (Auth → URL Configuration): set **Site URL** to `https://goodheart-labs.github.io/cn-return-bot/notes/` and add it (plus `https://goodheart-labs.github.io/cn-return-bot/**`) to the redirect allow-list — otherwise confirmation/magic links fall back to Supabase's default `http://localhost:3000`. Mirror the branded email templates (`supabase/templates/confirmation.html`, `magic_link.html`) under Auth → Email Templates; config.toml only styles local dev.

## Review dashboard

Dashboard listens on port 8001 — free it first in case a previous run is still bound.

```bash
bun run review        # Production Supabase
bun run review-local  # Local Supabase
```

## Database

See [DATABASE.md](docs/DATABASE.md) for full schema, column descriptions, enum values, and data flow. See [community-notes-data.md](docs/community-notes-data.md) for X's public Community Notes data schema.

Quick guide: use `notes` for performance analysis and submission metadata (the old `canonical_note_information` was merged into it in May 2026), `pipeline_runs` + `pipeline_scores` for debugging.

## Notewriter scraper

The main scraper is `src/scraper/scrapeNotewriterClickThrough.ts`. It connects to a local Chrome via Puppeteer CDP (port 9222), scrolls through the notewriter page, clicks "View details" on each note to extract the real note ID and status from the modal, then imports to Supabase. When it breaks, we can rejoin from the same position. 

- **Notewriter account**: `wholesome-raspberry-stilt` (the only active one)
- **Primary purpose**: Full coverage audit — ensure every note we've written is tracked in the DB
- **Data destination**: `notes` + `scraped_notewriter_snapshots` tables (snapshots are the time-series; reconcileSnapshots derives the canonical `notes` row)
- **Key technical detail**: X's notewriter page scrolls on `document.documentElement` (the `<html>` element), NOT window or body. The virtualizer only renders ~5-10 cells at a time.
- **One scraper**: Only `scrapeNotewriterClickThrough.ts` exists. Legacy scrapers were deleted Feb 2026.

Usage:
```bash
# Single command — auto-starts Chrome on port 9222 if not already running.
# First-time only: log into X in the launched Chrome window before re-running.
bun run scrape              # default 500 notes
bun run scrape 5000 --fresh # full pass from the top
bun run scrape 5000 --start-from <noteId>  # resume from a previous run
bun run scrape --incremental # daily mode: from top until ~1 week before the oldest un-snapshotted note (also re-samples recent notes)
```

Background-throttling: the `scrape` command launches Chrome with
`--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`
so the scrape keeps running at full speed even when the Chrome window is covered,
minimized, or behind a fullscreen app. Without these, macOS marks the tab hidden,
Chrome pauses `requestAnimationFrame` + throttles timers, and the X virtualizer
stops rendering new cells (the scrape stalls). Flags only take effect on a cold
Chrome start — if a flag-less debug Chrome is already on :9222 it gets reused.

### Daily automated scrape (launchd)

`--incremental` is the unattended daily mode. It finds the oldest known note that
has no scraper snapshot yet (cheap indexed lookup on `notes.first_snapshot_at`,
see migration 048) and scrapes from the top until ~1 week before that note. That
same pass re-samples every note above the cutoff, so recent notes accumulate
multiple view-count datapoints over time. If every known note already has a
snapshot there is nothing to catch up and the script exits without scraping.

A note the scrape scrolls past but never captures (deleted, never shown, etc.)
accrues a miss; after 2 misses it's given up (`notes.scrape_misses = 2`) and no
longer anchors the window, so a permanently-dead note can't pin the daily scrape
to its date. A later capture (e.g. a full `--fresh` pass) stamps its snapshot and
drops it from the candidate set, healing the give-up.

Scheduled on this Mac via a LaunchAgent (source of truth checked in at
`scripts/com.cnreturnbot.dailyscrape.plist`, wrapper at `scripts/run-daily-scrape.sh`):

```bash
# Install / change schedule
cp scripts/com.cnreturnbot.dailyscrape.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.cnreturnbot.dailyscrape.plist 2>/dev/null
launchctl load -w ~/Library/LaunchAgents/com.cnreturnbot.dailyscrape.plist

launchctl start com.cnreturnbot.dailyscrape   # run now (one-off)
launchctl list | grep dailyscrape             # check it's loaded
ls -t ~/Library/Logs/cn-scrape/               # per-run logs
```

Runs daily at 13:00 local. If the Mac is asleep then, launchd runs it on next wake
(no auto-wake). One-time prerequisite: the `~/.chrome-debug-profile` Chrome must be
logged into X on the notewriter account; that session persists across runs.

## Standing permissions

- **Scraper**: Claude can start the scraper at any time without asking. Use `~/.bun/bin/bun run scrape` with appropriate flags. Ask before stopping it.

## Gotchas

- OpenRouter model IDs use dots: `anthropic/claude-opus-4.6` not `claude-opus-4-6-20251101`
- GitHub Actions uses bun, not npm
- The notewriter page virtualizes its list - can't Ctrl+F, need the scraper
- After compacting, ask Nathan what to do next. 
- Do not delete database enries without confirming. 
- Common error for supabase to only display the first 1000. Make sure you are getting them all.
- Community Notes has `currentStatus` (overall) and `currentCoreStatus` (core submodel only, can be empty). Always use `currentStatus` / `current_status` when checking if a note is helpful — `currentCoreStatus` misses notes rated helpful by expansion/group models.

## Running locally

```bash
bun install
bun run src/production/runPipeline.ts          # full pipeline (same as GH Actions)
bun run src/production/runPipeline.ts --local   # local mode
```

When running locally, the prod X API keys must only be used for reading (fetching tweets, fetching note feedback). Never submit notes or perform any account-modifying action with the prod key without explicit approval — use `LOCAL_X_*` for that.

### Replay a cheap-bot run from prod logs (`tryoutNotes --from-db [level]`)

Re-run a tweet's most recent cheap-bot run locally, reusing data from its prod
logs. Pick how deep to reuse (each level includes the previous; default `tweet`):

```bash
bun run src/local/tryoutNotes.ts <tweet-id> --from-db          # = tweet
bun run src/local/tryoutNotes.ts <tweet-id> --from-db input
bun run src/local/tryoutNotes.ts <tweet-id> --from-db note
```

- `tweet` — reuse the post (no X fetch); rebuild input + search + writer + gates.
- `input` — also reuse the full input (comments, media analysis, author history).
- `note`  — also reuse the written note → only the note-needed judge + source
  verifier re-run (e.g. "what would the verifier do now / on a different model?").

It looks up the latest `pipeline_runs` row in prod and **seeds the existing
caches** from its logs — no pipeline code changes: the input cache makes
`createBotInput` short-circuit, the writer cache makes the orchestrator replay
from the gates. Forces `--bot cheap-bot`. See `src/local/seedReplayFromDb.ts`,
`src/pipeline/input/inputCache.ts`, `src/pipeline/cheap-bot/writerCache.ts`.
