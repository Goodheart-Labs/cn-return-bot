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
bun run everything-auto-enqueue [--dry-run]                       # enqueue the next unprocessed followed-feed items (everything_followed_feeds table)
bun run commonnotes                                              # local FE on port 8003 against the PROD backend (.env.prod-backend, gitignored: prod URL + anon key)
bun run commonnotes-local                                       # local FE against the local Supabase (VITE_SUPABASE_* in root .env)
```

Ingestion is unified under `everything-enqueue` — the only front door. A **bare URL** is fetched by the worker. A **`--doc [<url>] <file>`** supplies the extraction body from a local `.md`/`.txt` file (the text is stored on the item at enqueue in `full_text`; the worker uses it instead of fetching). For a YouTube `<url>` the worker still fetches the video's cues so each claim's timestamp snaps onto them — this is how you fact-check from an author's clean published transcript rather than noisy auto-captions; any other `<url>` becomes the article's source link (text-anchored, no timestamps). With **no url** (`--doc <file>`) the item gets a synthetic `local:<slug>/<file>` key and renders no source link (`isSyntheticDocUrl` → `context_url` null). **`--manifest <dir>`** expands `README.md` rows (`Source: <base>` + `- [title](file.md) — \`/path\``) into a batch of `--doc` pairs. There is no separate importer — the old `import-files` / `import-dwarkesh` / `import-claims` scripts and the standalone `checkYoutubeClaims` podcast pipeline were removed; podcasts now go through `--doc <youtube-url> <transcript>`.

**Automated ingestion**: the `Everything Priority Feeds` workflow (dispatched by Supabase pg_cron at :03/:33, migration 067, paused by 070, resumed by 071 — same PAT-in-Vault pattern as the create-notes routine) runs `everything-auto-run`: repeated consume→enqueue→process cycles (`BATCH_SIZE` per cycle), starting another cycle only while total elapsed time is under 5 min — so quick items don't waste a 30-min dispatch slot, while a long item still runs to completion past the budget. Each cycle starts with `src/everything/consumeRequests.ts` (migration 077), which is free of LLM cost and therefore runs even on a capped day: pending `everything_note_requests` rows become queue items at the top priority tier (an already-ingested page instead resolves the request against its item — bump/done/requeue-on-error), and pending `everything_follow_requests` rows are validated with one feed listing and promoted into `everything_followed_feeds`. **Queue priority** (`everything_items.priority`): requested 2 > followed 1 > backlog 0; within a tier the worker takes the newest `published_at` first (nulls, i.e. fresh requests, before dated rows, FIFO among themselves). A paragraph request is checked selection-only: the highlighted text becomes the item's `full_text`, never the whole page. Every requested page that is not a YouTube video becomes a `web` item under the catch-all "Around the web" project, the same one the write-anywhere flow uses (migration 079 folded the old "Requested by readers" project into it) — no Substack special-casing. Its text comes from the captured `page_text` when the request carries one; otherwise the worker fetches the page itself through the X pipeline's web-fetch ladder (`fetchWebPage` in `src/pipeline/tool-calling/tools.ts`: three user agents → Wayback → archive.ph → headless Chromium, with a raised char cap), strips the markdown to plain text so claim quotes still anchor on the live page, and turns markdown images into the pipeline's `[[IMAGE:url]]` markers (tiny CDN-resized ones dropped as UI furniture). A bare `substack` item whose API fetch fails (CI IPs are 403'd) falls back to the same ladder. **Daily spend cap** (`src/everything/spendCap.ts`): today's `everything_pipeline_runs.cost` is summed in the DB (`everything_cost_since` RPC) before each item and each claim; default $55 ≈ €50, override with repo variable `EVERYTHING_DAILY_SPEND_CAP_USD`. An item cut short mid-claim is requeued (its unchecked claims stay `pending`) and the normal resume path finishes it next day. The auto-enqueue then walks the `everything_followed_feeds` table in its stored order — reader-followed feeds first (priority 1), then the curated rows migration 077 seeded (priority 0, ordered by `sort_order`: Zvi's Substack, Dwarkesh's YouTube channel, then ACX, Silver Bulletin, and Slow Boring); the old hardcoded `priorityFeeds.ts` list is gone, so adding an author is a row insert (`project_slug, feed_type, feed_url`, custom-domain publications in their `*.substack.com` form, the only shape the relay's allowlist accepts), not a deploy. It lists each feed's latest entries (Substack RSS `/feed` / channel `/videos` tab via one flat-playlist yt-dlp call — Shorts excluded), drops entries that already have an `everything_items` row (any status; YouTube matched by video id since stored URL forms vary), and enqueues the remaining ones **newest first**, 1 per run across the list (`BATCH_SIZE`) — new posts never wait behind old backlog (gaps further back are fine and get filled once a feed is otherwise caught up), and the ~15–20-entry feed window bounds how far back this can reach. Items stranded in `processing` by a killed run (e.g. the 120-min job timeout) are **resumed**, not lost: every extracted claim is persisted with its own status before checking starts, so the next run requeues the item and the worker redoes only its `pending`/`error` claims (an error on an orphaned item is likely a kill artifact), keeping completed ones; only an item with no extracted claims at all is marked `error` (kill landed mid-extraction — requeue manually). **Never run `everything-auto-enqueue`/`everything-worker` locally while the CI dispatch is active**: the no-two-workers guarantee lives in the workflow's concurrency group, which a local run bypasses — local triage will see CI's in-flight item as "stranded", requeue it, and two workers will race on the same claims. Pause the cron (migration 070) or wait for the run to finish first. **YouTube from CI goes through a residential proxy**: YouTube refuses every per-video request (metadata, subtitles, streams) from datacenter IPs with "Sign in to confirm you're not a bot" — no player client or PO token gets past it, only the IP matters (channel *listings* are exempt). All yt-dlp calls targeting youtube.com therefore add `--proxy $YTDLP_PROXY_URL` when that env var is set (`ytDlpProxyArgs` in `src/pipeline/media/ytDlpDownload.ts`; secret set in the priority-feeds and create-notes workflows — the X pipeline's source verifier hits the same block on cited YouTube links). The provider is DataImpulse (pay-per-GB, Jim's account); swapping providers is a secret change, not a code change. Non-YouTube sites are always fetched directly — they work without a proxy and proxy traffic costs per GB. **Substack from CI goes through our Cloudflare Worker relay** (`src/everything/substack-proxy-worker/`, deployed on Jim's free CF account; secrets `SUBSTACK_PROXY_URL`/`SUBSTACK_PROXY_KEY`, unset locally → direct fetch): Substack 403s datacenter IPs outright and rate-limits Workers egress on its `api/v1` endpoints, but serves `/feed` from Workers reliably — so the automated path is RSS-only, and posts are enqueued with their RSS body as `full_text` (the worker never fetches Substack; `published_at` set at enqueue). **Paid posts** appear in RSS as preview-only bodies (detected by their trailing "Read more" link) and are never auto-enqueued — each run logs them and they wait for the **subscriber-inbox path**: Nathan subscribes to the paid publications, the full text arrives in his email, and admin-Claude enqueues it locally via `everything-enqueue --project <slug> --doc <canonical-url> <file>`; using the feed's canonical URL makes the item row mark the post processed for future runs. Every fact-check of a claim writes an `everything_pipeline_runs` row (migration 068: outcome, ab picks, full tweet log, LLM cost — the everything counterpart of `pipeline_runs`, kept separate so synthetic ids never pollute tweet analyses; service-key only).

Pipeline: per claim it forces `bot=simple-bot, note_prefilter=off, search_claim=on`; search runs on Opus 5 (`simple_bot_search=opus5-native`), the writer on Sonnet 5 (`simple_bot_writer=sonnet5`), the source verifier on Gemini 3 Flash, non-claim-based (`verifier_claim_based=classic`, the single-call accept/reject flow) with `verifier_citations=on` (accepted sources carry a verbatim supporting quote + explanation). Confident-true claims skipped (`shouldFactCheck`). Substack images are fed inline to the Opus claim extractor, so a claim can rest on text, an image, or both (`context_quote` nullable, `image_urls` carries the images).

Data model (migration 050): `everything_projects → items → claims → notes`, plus `everything_votes`. Migration 050 also locks the anon role out of every other table (anon key is baked into the public site). Migration 053 dropped the one-note-per-claim constraint (a claim can hold the AI note plus user drafts); migration 055 dropped the old `everything_note_suggestions` table. Migration 056 moved a note's citations out of the `everything_notes.sources` jsonb column into a dedicated `everything_note_sources` table (`url, quote, explanation`), one row per supporting snippet. Migration 057 added `everything_claims.image_urls` (images a claim is grounded in) and made `context_quote` nullable (image-only claims carry no text excerpt). Each claim carries a `context_quote` (the highlighted span) and a wider `context_paragraph` (surrounding passage), both produced by the Opus extraction step. `everything_items.full_text` (migration 054) is the item's body text and is now persisted on ingest for every source (what the public write-note flow searches) — no backfill needed. Migration 058 added `everything_notes.improved_from_note_id` (an improvement's link to its original) + a trigger auto-casting the author's helpful vote on their own note. Migration 059 gave `everything_votes` a surrogate `id` and a `reasoning` column (the column is now unused — the UI posts comments instead of private reasoning), plus the private `everything_donations` ledger (`vote_id unique, charity, amount_usd`; own-rows RLS, no anon access). Migration 061 turned the donation ledger outcome-contingent: `amount_if_helpful` / `amount_if_not_helpful` (the pair frozen at vote time), with `amount_usd` now the settled amount (null until the note's rating locks in; old flat-$2 rows keep `amount_usd = 2`). Migration 063 added `everything_note_not_needed` (+ `_votes`, counter/self-vote triggers mirroring notes) and dropped the comments tables from migration 060 (`everything_comments` + `everything_comment_votes`, data discarded).

Auth & interaction:
- **Reading** is anonymous. **Voting** and **writing/improving notes** require login (emailed 8-digit code or X) — votes key on `auth.uid()` via RLS; counters via trigger.
- **Note actions** (inline on every note): **Suggest an improvement** posts your rewrite as your own `draft` note on the *same claim*, linked via `improved_from_note_id` — it renders as its own card with ↑/↓ jump-links to/from the original (no nesting, no replacement); **Share** copies a deep link; **Delete** (⋯ menu) shows only on notes you authored (RLS: delete own `draft` notes, migration 053).
- **Vote donations (shrinking stake)**: every note vote — except on your own note — mints a donation with a **frozen outcome-contingent pair**: $X if the note settles rated helpful / $Y if not, computed at vote time from the note's running vote tally. The note has a latent quality θ (share of raters who'd call it helpful); votes are draws from that pool, so a Beta(1.68, 3.32) prior makes updating literal counting (Helpful +1 to a, Not-helpful +1 to b, **Somewhat +0.5 to a only** — so a Somewhat vote can only ever count *for* a note), and it settles helpful iff θ clears X's CRH bar of 0.40. Payout is the Brier score change ×$6.25, lifted by a **state-dependent base** — the worst score drop any vote could suffer from that tally — plus a $0.25 tip. Because information genuinely runs out as θ is pinned down, donations decay on their own with no decay knob: **$3.08 for the first Helpful vote, $0.50 for the sixth, ~$10.60/note** (was a flat-based log rule that paid $1.47 on the sixth and $16/note). Nothing is ever negative and the whole card shrinks together; the base is incentive-neutral because it depends only on the tally you walked into, never on how you vote. **Rating**: p ≥ 0.78 → helpful, p ≤ 0.20 → not helpful. Thresholds bracket the tallies Jim specified: 2 Helpful alone is not enough (p = 0.746) but 2H + 1 Somewhat is (0.808); 1 Not-helpful is not enough (0.235) but 2 are (0.156). No explicit quorum — no single vote can reach either threshold. Enough Somewhat votes alone do rate a note helpful (5 of them), which is intended. Derivation, rejected alternatives, and tuning: `src/scripts_jim/2026_07_21_donation_decay/RESULTS.md` — the reference Python model there is the source of truth if `lib/donationScoring.ts` is ever changed. The pair is upserted keyed to the vote (`unique(vote_id)`, re-votes refresh it, retracting cascades it away). The voter picks the charity *after* voting (GiveDirectly default; GiveWell / ACE / EA LTFF; choice remembered). The post-vote box is donation-only — no reasoning prompt (discussion is its own action on the note). The team settles + fulfils donations manually from the ledger once a note's rating locks in. UI: `VoteDonation.tsx`, libs `lib/donationScoring.ts` (formula), `lib/donations.ts` (`CHARITIES`, ledger writes).
- **Note not needed**: written via **Note not needed** in the note's action row (login required, ungated) — a flat free-text argument that the claim needs no note, keyed to the **claim** (`everything_note_not_needed`, migration 063), so the same list renders under every note on that exact text (original, improvements, manual notes). No nesting (`NoteNotNeeded.tsx`). Entries take the same three-way votes as notes (counter + author-self-vote triggers) but entry votes never mint donations. Entry ranking is by age, not votes.
- **Earnest gate**: user text paths — writing a note (WriteNoteModal), suggesting an improvement (but NOT "Note not needed" — that stays ungated) — go through the `supabase/functions/judge-note` edge function (LLM, earnest-vs-trolling, verdict-only — it stores nothing). The client posts only on an `accepted` verdict; rejected text is never written (WriteNoteModal judges *before* creating its claim, so no orphan claim). Needs `OPENROUTER_API_KEY`; `verify_jwt=false` (self-authorizes via `getUser`). Local: `supabase functions serve judge-note --env-file .env`. The gate is advisory (keeps the OpenRouter key server-side + filters the UI path); it is not RLS-enforced, so a crafted client could still insert directly.
- **Feed ranking**: every note is its own card (no per-claim promotion). One predicate — `noteStatus` (`lib/noteScore.ts`) — decides the card badge, the feed section, and which side of a frozen donation pair pays out: a note is rated once ≥2 votes are in and **p ≥ 0.75** (helpful) or **p ≤ 0.25** (not helpful), so 3 unanimous Helpful votes or 2 Not-helpful ones; the quorum stops one voter rating a note alone. (Replaced the old ">=5 ratings and net-positive weighted score" rule.) Three sections in `App.tsx`, each ordered by **p** (`lib/noteBelief.ts`) so the feed reads as one gradient: notes needing ratings first, by the p **one more Helpful vote** would give them (highest first — closest to resolving; ties → oldest first); then a **"Helpful notes"** divider, ascending p (most confidently helpful sits lowest); then an **"Unhelpful notes"** divider, descending p (least helpful sinks lowest); finally a **"Source has since changed"** divider for notes whose claim carries `updated_quote` — the author has edited the text the note was written against, so it may no longer apply. That last group outranks the rating status: a note on stale source drops to the bottom however it was rated. Vote tallies stay hidden until you vote (no anchoring) — except on a **rated** note, where the counts show to everyone immediately, and on notes older than 7 days. A just-voted note holds its exact slot for 6s (ranking inputs freeze at vote time — `voteHolds` snapshots) so it doesn't teleport while you reconsider.
- Email sign-in is the same two-step flow on website and extension: `signInWithEmailCode` → `verifyEmailCode` (`everything-shared/auth.ts`), the code typed where it was requested. No magic links — email auth never touches the redirect allow-list and works across devices.
- X sign-in needs `TWITTER_CLIENT_ID` + `SUPABASE_AUTH_EXTERNAL_TWITTER_SECRET`. OAuth redirects back to the origin the user signed in from (`redirectTo: window.location.href`), but only if that origin is on the target project's redirect allow-list — otherwise Supabase silently falls back to the Site URL. Local project's list is in `supabase/config.toml` (localhost:8003/8004, `*.github.io`, commonnotes.net); the prod list is dashboard-only (Auth → URL Configuration) and must include the localhost origins to test X sign-in locally against the prod backend.
- **Analytics (Supabase)**: Supabase-first — metrics come from the `everything_*` tables wherever the DB records the fact; events exist ONLY where the DB is blind and land as rows in `everything_events` (migration 077: insert-only for clients, event-name whitelist CHECK, jsonb `props`, `device_id` + nullable `user_id`). Vocabulary: web `pageview`, extension `notes_shown` + `extension_installed`, and `sign_in_started` / `signed_in` / `vote_gated_login` / the write-note teaser / judge rejections on both. There is no `note_voted` event — votes live in `everything_votes` (with `platform`, migration 069) and the funnel reads them there. Before adding an event, check whether a table already records it. Capture points call `track()` from `everything-shared/analytics.ts` (a sink registry, no-op until a transport registers): the website inserts directly via the shared anon client (`everything-web/src/lib/analytics.ts` — device id in localStorage, initial `pageview` on load + manual dedupe on query-param navigation, device-id reset only on true sign-out), the extension routes every event through the background (`everything-extension/utils/analytics.ts` — background owns `cn-device-id`/`cn-user-id` in `chrome.storage.local`, sources `user_id` from the live session because RLS checks it against the JWT, and derives `signed_in`/reset from the `sb-*-auth-token` storage key). Events on any event row that happens signed-in carry both ids — that pair is the stored device→user link. The dashboard at `/cn-return-bot/analytics/` (`src/analytics-dashboard/`, `bun run analytics` / `analytics-local` on port 8004) reads live aggregates via the security-definer RPCs `everything_funnel(window_days)` and `everything_daily_activity(window_days)` — the anon key can never read raw events. No analytics key or secret exists.

Prod prerequisites (manual): run migrations (incl. 058–061; 060's realtime-publication line included); `supabase functions deploy judge-note` + `supabase secrets set OPENROUTER_API_KEY=…`; repo secret `SUPABASE_ANON_KEY`. In the prod project's dashboard (Auth → URL Configuration): set **Site URL** to `https://goodheart-labs.github.io/cn-return-bot/notes/` and add it (plus `https://goodheart-labs.github.io/cn-return-bot/**`) to the redirect allow-list — X OAuth redirects there. Mirror the branded email templates (`supabase/templates/confirmation.html`, `magic_link.html`) under Auth → Email Templates; config.toml only styles local dev.

## Browser extension (Common Notes)

`src/everything-extension/` — WXT (Vite) extension, Chrome MV3 + Firefox, showing Common Notes inline on the pages themselves. Shares all Supabase/domain logic via `src/everything-shared/` (moved out of `everything-web/src/lib`; both apps import it — no copies) and reuses `NoteBox`/`NoteMenu` from `everything-web` plus `VoteRatings` from `dashboard-shared` (wrapped in `NoteWithActions`; every note on a claim renders as its own peer box), follows the HOST PAGE's light/dark theme (`utils/pageTheme.ts`: `color-scheme` declaration else rendered-background luminance, Dark Reader's approach; a `.dark` class toggled on each shadow container drives Tailwind `darkMode: "class"` — the web apps pin the same strategy and never set `.dark`, staying inert), with Tailwind v3 compiled into a shadow-root stylesheet (host pages untouched; passage tint via the CSS Custom Highlight API, no DOM mutation).

```bash
bun run dev-ext     # WXT dev mode vs PROD backend (load .output/chrome-mv3-prod-backend unpacked — WXT suffixes the output dir with the mode)
bun run dev-ext-local # dev mode vs local Supabase (outputs .output/chrome-mv3)
bun run build-ext   # chrome + firefox production builds (--mode prod-backend)
bun run zip-ext     # store-ready zips (also built by .github/workflows/build-extension.yml)
```

How it works: a content script resolves the page URL to an `everything_items` row (`notesQuery.ts: normalizePageUrl`/`fetchItemForUrl` — canonical-link aware; YouTube matched by video ID), fetches that item's notes, and anchors each claim's `updated_quote → context_quote → context_paragraph` to a DOM Range by normalized fuzzy matching (`utils/anchor.ts`, same `normalizeText` the pipeline's timestamp-snapping uses; first/last-6-words fallback for drifted quotes). Substack + YouTube are injected by default; every other site with notes goes live via the background's noted-sites sync (5-minute `alarms` pull of noted hostnames from the DB → `scripting.registerContentScripts`) — a new site reaches existing installs without a store update. `<all_urls>` is a required install-time permission (the old per-site grant.html consent flow was removed Aug 2026; Chrome disables an updated install until the user re-approves the broadened permission). There is no per-site opt-out: notes show on every site that has them (a "Hide notes on this site" toggle existed briefly and was removed on Jim's call, 2026-08-17). YouTube gets a timestamp-triggered overlay in `#movie_player` (pill ↔ expanded votable card, driven by `start_seconds`/`end_seconds`). Right-click a selection → "Write a Common Note on this" (judge-gated `postClaimWithNote`, shared with the website's WriteNoteModal).

Firefox content scripts are the compatibility hot spot (all three found the hard way): DOM objects are Xray-wrapped, so the iterator protocol on `URLSearchParams` doesn't exist there (collect keys via `forEach`); `navigator.locks` hands back page-compartment Promises the sandbox may not touch (the shared client passes a pass-through auth `lock`); and cross-origin fetches to non-permissioned hosts fail with a bare NetworkError — hence the `https://*.supabase.co/*` host permission. Chrome's isolated worlds have none of these.

Auth: one Supabase session in `chrome.storage.local` (adapter branch in `everything-shared/supabase.ts`; content-script localStorage belongs to the host page, hence the adapter; `autoRefreshToken` off — MV3 workers lose timers, `getSession()` refreshes on demand). Sign-in is inline: the popup's `LoginPanel` also renders inside the note popover / YouTube card (when a signed-out reader tries to vote — `OverlayLogin`) and in the write-note overlay, so no flow bounces through the toolbar icon; the pending email lives in `chrome.storage.local` with a 1h expiry (not storage.session — content scripts can't read it), so the code step survives tab switches and is shared across popup and overlays. Email sign-in is the shared 8-digit code flow, typed into the popup (`{{ .Token }}` in BOTH the magic-link and the signup-confirmation templates — new users get the confirmation template, so both matter; the templates are code-only, no `{{ .ConfirmationURL }}`; mirror both in the prod dashboard). X sign-in runs `launchWebAuthFlow` in the background; the extension redirect URLs must be on the redirect allow-list (config.toml has local wildcards; prod dashboard needs the concrete entries). Both extension IDs are pinned (Chrome: manifest `key` field, public half of a self-generated keypair, private half in gitignored `chrome-signing-key.pem` — needed only to claim the same ID on the Web Store later; Firefox: `gecko.id`), so the redirect URLs are known in advance. Paste-ready for the prod dashboard (Auth → URL Configuration → Redirect URLs):

```
https://jodkhmefbcmgldokmeicpdogkepmcnij.chromiumapp.org/**
https://edc17663d98cd6a49556fdc1882c73dace1728c1.extensions.allizom.org/**
```

(The Firefox subdomain is SHA-1 of `extension@commonnotes.net` — the original `common-notes@commonnotes.net` id was permanently burned when the first AMO listing was deleted; never delete an AMO listing. Confirm the hash once by logging `browser.identity.getRedirectURL()` in a Firefox-loaded build before relying on it.) Email/code login needs no allow-list entry; only the X button does. No realtime — notes refetch after votes.

Privacy + coverage: the background's sync caches the full covered-page URL list locally (`cn:coveredPageUrls`) plus per-URL per-status note counts (`cn:notedPageStatusCounts`); content scripts decide "is this page ours?" on-device (`utils/coveredPages.ts`) BEFORE any backend lookup. Opening a post or video on Substack/YouTube or a `/posts/` page on LessWrong writes an anonymous row to `everything_link_visits` (migration 076, insert-only for clients) — visit counts per link, no user id, **covered or not** (Aug 2026: the counts tell the team where notes are needed; covered pages matched by item source so custom domains count, uncovered ones by URL shape). Recording is inert until the **settings onboarding** has run (`cn:settingsOnboardingDone`; the background opens the settings page once on install/update) and obeys per-site checkboxes there. The settings page (`entrypoints/options/`, options_ui in a tab, also linked from the popup) holds those checkboxes, four overlay toggles (`cn:settings`: request card OFF by default, note-count card / thumbnail badges / follow cards on), the note filters, and sign in/out; the popup is just the primary action + Settings link. No request surface appears for handled content: the request card and popup button hide when the author's feed is followed, and the context menus (selection + page-context "Request Common Notes on this page") answer with an info card instead of submitting when the page is covered or the author followed (`cn-request-info`, `utils/requestInfo.ts`). The unchecked-page card and the follow offer each show **once per subject** (per page URL / per feed URL, rolling lists in storage.local, `utils/overlayMemory.ts`); later visits show nothing and the menus/popup remain the way to ask. The note counts drive listing badges (`utils/coverageBadges.ts`): a listing card that links to a noted page (Substack front pages, YouTube channel tabs, generic `article`/`li` listings) gets a small glyph+count circle pinned to the upper-right corner of its cover image / thumbnail (card corner when there is no image), matched on-device against the cached counts. Visual verification runs headlessly on the devbox: `bun run src/everything-extension/scripts/preview.ts <url> <out.png>` opens the page in Chromium with the freshly built extension loaded and screenshots it (needs `LD_LIBRARY_PATH=~/.cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu` on machines without Chromium's system libs). The popup pings `cn-sync-noted-sites` on open, and the sync injects into already-open tabs on newly-registered hosts (registration alone only affects future loads). Requesting notes has three surfaces (all → `everything_note_requests`, which the pipeline consumes into the queue since migration 077): the **transient status card** (`StatusOverlay.tsx` via `mountStatusOverlay.tsx`, bottom-right, auto-hides after 10s) — on an ingested page it says "N Common Notes on this page, M need more ratings" (N = rated-helpful notes, M = unrated ones, disjoint; the numbers deliberately IGNORE the note filters — the card reports what exists — while the thumbnail badges do the opposite and count only filter-visible notes, because a badge promises what opening the page will show, live-rebuilt on filter changes; the card headline is click-to-jump only while at least one note actually renders; gated by the note-count toggle), on an unchecked Substack `/p/` post or YouTube watch page it says "we haven't checked this post/video yet" with **Request Common Notes** (only when the request-overlay toggle is on AND the author's feed is unfollowed) and, for an unfollowed author, **Request notes on all new posts from this author/youtuber** (→ `everything_follow_requests`; Substack in its `*.substack.com` form, YouTube channel read from the watch page's owner box); the **popup**, which shows the request + follow buttons on uncovered content pages (search engines/new-tab excluded; a followed author's page instead says "We check every new post/video from this author/youtuber"); and the **context menus** on every page — "Request Common Notes on this" over a selection, "Request Common Notes on this page" on a plain right-click (badge ✓/! feedback). Author pages get a follow-only card: publication homepages, Substack profile pages (`substack.com/@handle`, resolved to the publication via the public-profile API, custom domains included) and YouTube channel pages, shown only while the author's feed is not on the synced followed list (`followTarget.ts`, `followedFeeds.ts`, anon-readable `everything_followed_feeds.feed_url` via migration 079) and the follow-overlay toggle is on. Reader-style Substack links (`/home/post/p-<id>`, `/@author/p-<id>`) are resolved to their publication URL by a body-cancelling redirect fetch in the background (`cn-reader-redirect`, cached in `cn:readerPostCanonicals`), so coverage badges also appear in the Substack home feed and on profiles. Requests carry the page's body text captured on-device (`utils/pageCapture.ts` — in-page and via activeTab `executeScript`), which is what lets the pipeline check pages it cannot fetch; requested pages/follows are remembered in sync storage so the buttons show their done state instead of double-submitting. Writing works ANYWHERE: the "Write a Common Note on this" selection menu is on every page — on uncovered pages the click's activeTab grant injects `generic.js`, and posting lazily creates the page's item via `ensureWebItem` (`source='web'` under the catch-all `web` project, client-insert RLS from migration 068). The only static first-class text site is `*://*.substack.com/*` (single source: `utils/staticSites.ts`, mirrored by `notes.content.ts` matches); every other text site (incl. ai-2040.com since Jul 2026) is covered by the background's noted-sites sync. The extension icon is generated from `src/everything-extension/assets/icon.svg` via `bun run scripts/generate-extension-icons.ts` (PNGs checked in under `public/icon/`).

Distribution without stores: `.github/workflows/build-extension.yml` keeps a rolling `extension-latest` GitHub release updated with both zips; install steps in `src/everything-extension/README.md` (Chrome: load unpacked — pinned ID makes every install identical; Firefox: temporary load only until we run Mozilla's automated unlisted signing once).

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
