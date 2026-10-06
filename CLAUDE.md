# CLAUDE.md

Project context for Claude Code sessions.

## What this is

Two products share this repo.

- **The X bot** writes Community Notes for X/Twitter posts and submits them through X's note-writing API. Several bot variants write notes and predict how they will be rated. The `Create Notes Routine` workflow runs it every 30 minutes. GitHub's own scheduler drops runs, so the workflow is dispatched by pg_cron, a Postgres extension that runs scheduled jobs inside our Supabase database.
- **Common Notes** (internally "everything", so the tables are `everything_*` and the folders `src/everything*`) writes notes on YouTube videos, Substack posts and other web pages. It shows them on a public website (commonnotes.net) and inline on the pages themselves through a browser extension.

The goals, in order: views of AI-written notes, misleading views suppressed, getting notes onto a platform other than X, and views of our own notewriter account.

## Tech stack

- TypeScript and Bun. GitHub Actions also runs Bun, not npm.
- LLM calls go through OpenRouter. Model IDs use OpenRouter's format with dots, for example `anthropic/claude-opus-4.6`, not Anthropic's `claude-opus-4-6-20251101`.
- Supabase (Postgres) for all data.
- React, Vite and Tailwind for the website, the dashboards and the extension (WXT).

## Key directories

- `src/pipeline/` - the X bot's note writing: `simple-bot/` (search, writer, correction extraction), `prefilter/` (cheap gates before the bot), `verify/` (source verification), `score/` (calls X's `evaluate_note` endpoint, not an LLM), `llm/`, `ab-testing/` (every A/B arm, including which model each stage uses), `prompts/`, `media/`, `orchestration/`, `capacity/` and `ranking/` (how many notes to submit and in which order), `utils/`.
- `src/production/` - entry points for GitHub Actions (`runPipeline`, `updateNoteFeedback`).
- `src/service/` - the services that do the expensive work for both products (see "Services machine" below).
- `src/local/` - local tools (`tryoutNotes`, `runOnVideos`, `evaluateResults`).
- `src/scraper/` - the notewriter page scraper.
- `src/everything/` - the Common Notes pipeline: ingestion, the feed run, the worker.
- `src/everything-core/`, `src/everything-ui/`, `src/everything-features/` - the shared layers of the Common Notes frontend.
- `src/everything-web/` (website), `src/everything-extension/` (browser extension), `src/analytics-dashboard/` (Common Notes analytics), `src/review-dashboard/` (X note failures).
- `src/signal-bot/` - a Signal chat bot that drafts a note for a pasted tweet and submits it after a human says yes.
- `src/scripts_jim/`, `src/scripts_nathan/`, `src/scripts_rob/` - personal investigation journals, one dated folder each.
- `migrations/` - Supabase SQL migrations. `ops/` - the services machine.

## Services machine

One always-on Linux server (the "services box") runs these systemd services, described in `ops/README.md`:

- `cn-claim-check`: one claim or one tweet in, a note with verified sources out.
- `cn-extraction`: text in, the claims in it and their ratings out.
- `cn-intake`: picks up reader requests for Common Notes at once and drives them through the other two.
- `cn-fetch`: fetches every outside page and image in a sandbox without keys.
- `cn-pot-provider`: a Docker container that hands out YouTube PO tokens on 127.0.0.1:4416 (see "Fetching sources").
- `cn-notify`: posts new notes and votes to four Slack channels as the bot "Claudy" (see "Slack announcements" in `ops/README.md`).

The X bot run and the Common Notes feed run are thin callers. They first check that the services they use are reachable and not stuck, and fail if not. Then they send the work over HTTP (`src/service/client.ts`, URLs in `CLAIM_CHECK_URL` and `EXTRACTION_URL`). The X bot uses only claim-check. So a change to note writing or claim checking reaches production only once the services box has deployed it. Deploying is a pull: a systemd timer runs `ops/autodeploy.sh` every 5 minutes, which pulls the checkout's branch and restarts the services once they are idle. A new unit file must be installed by hand once.

## Common Notes

### Vocabulary

- **Project** - a group of notes on the public website, one row in `everything_projects`. Usually one creator with their `feed_url`. The project `web` ("Around the web") collects one-off pages, and a few projects are one-time imports such as `ai-2040`. A page a reader requests, or writes the first note on, goes under its creator's project whenever the extension can name the creator (GOO-290): the extension sends the feed URL from `authorFeedForTab` (it reads a custom-domain Substack's `*.substack.com` name out of the page), a request carries it in `everything_note_requests.feed_url` (migration 110), and a reader's note goes through the `everything_creator_project` RPC (migration 111), which creates a missing project without priority. Only pages with no creator we can follow land in `web`. The feed URL is the key. The slug is only a name and may carry a `-2` suffix, so match creators by feed URL.
- **Feed** - the address we poll for a creator's new work: a Substack publication, a YouTube channel, or a LessWrong/Alignment Forum author profile.
- **Item** - one post, video or page, a row in `everything_items` and the unit of work. Its status is `queued`, `processing`, `done` or `error`. `checked_scope` is `page`, `paragraph` or null; only `done` with `page` means the whole page was checked. Null means a reader's own note created the row, so the page can still be requested.
- **Claim** - a factual statement pulled out of an item. Each check costs money. A claim may get a **note**.
- **Queue** - every `queued` item, ordered by `everything_items.priority` (`QUEUE_PRIORITY` in `src/everything/db.ts`). Tier 2 is pages readers requested; only the `cn-intake` service takes those, at once. The feed run takes the rest: a creator holding priority (1), then a creator walked because of readers (0), then a retry of an item that errored (-1). Within a tier, items without a `published_at` go first, then the newest.
- **Minisite** - one article on commonnotes.net/minisites/<slug>, a row in `everything_minisites` (migration 117). It stores the article in **reader text** (a small markdown subset with links, footnotes, quotes, figures and tables, `src/everything-core/readerText.ts`) and the list of reader features it switched on (`src/everything-core/minisiteFeatures.ts`). The item keeps the plain text the pipeline reads, made from the same text by `plainText()`, so pipeline quotes match the words on screen.
- **Admin** - anyone signed in with an email in `everything_admins` (Jim and Nathan). Admins create minisites, edit their features and start their fact-check. The database checks `everything_is_admin()` on every admin write.
- **Visit** - a row the extension writes to `everything_link_visits` when a reader opens a post or video. It has no account id, only a **reader hash**: a SHA-256 of a secret kept on the device and the creator's feed address. The hash differs per creator, so one person's reading cannot be joined across creators.
- **Reader** - a reader hash that opened at least two different pages of a creator (`MIN_PAGES_FOR_A_READER` in `src/everything-core/readers.ts`).
- **Run** - one dispatch of the `Everything Priority Feeds` workflow (`src/everything/autoRun.ts`). It checks the services' health and that intake has picked up every reader request, triages the queue, enqueues one post if the feed tiers are empty, processes exactly one feed item, sets the alarm, and exits. A run also goes red on purpose, after its item and alarm, in two cases: when its item failed, whatever the reason, and when the YouTube Data API quota ran out. The X bot's run goes red when every tweet it checked failed.
- **Alarm** - when the next run is due, stored in `everything_feed_schedule`. pg_cron checks it every minute and dispatches the workflow when it has come. If a run never sets its alarm, another is dispatched 45 minutes later.
- **Pacing** (`src/everything/pacing.ts`) - spreads the feed budget across the UTC day. The interval between feed posts is the hours left in the day times the mean cost of a recent feed post, divided by the money left.
- **Spend cap** (`src/everything/spendCap.ts`) - the daily ceiling on LLM cost: $50 by default, $10 of it reserved for reader requests. Feed work stops at $40, and pacing spreads that. Reader requests and passage questions stop once they have spent $25 in the day, which every pipeline cost row's `work_priority` column tells apart. The cap is the hard stop, checked before each item and each claim. Reader spending counts toward the day's total, so a large requested page delays the next feed run.

### Which creators get checked

A creator is walked for one of two reasons, and neither is permanent. Either `everything_projects.priority_until` is in the future (a press in the extension or `everything-prioritize` sets it to 7 days), or the creator had at least one reader in the last 14 days. The walk (`walkToFirstUnchecked` in `autoEnqueue.ts`) goes down that list, priority creators first and then by readers, and enqueues the first unchecked post it finds. Candidates per creator are their 5 newest free posts first, then their 5 most popular posts of all time (`topPosts.ts`; LessWrong authors have no top list). Adding a creator is a press in the extension or one `everything-prioritize` run, not a deploy.

### Commands

```bash
bun run everything-enqueue --project <slug> <url...>              # YouTube video, Substack post or profile, LessWrong/AF post or author (--latest N)
bun run everything-enqueue --project <slug> --doc [<url>] <file>  # local text as the body; a YouTube <url> still gives timestamps
bun run everything-enqueue --project <slug> --manifest <dir>      # one item per page listed in the folder's README.md
bun run everything-auto-run                                       # one feed run, exactly what CI runs
bun run everything-worker                                         # drain the feed tiers of the queue (up to the feed budget) and exit
bun run everything-auto-enqueue [--dry-run]                       # enqueue the next post the walk would pick
bun run everything-prioritize <creator-url...>                    # give creators 7 days of priority
bun run minisite-create <url> --slug <slug> [--features a,b] [--doc <file>] [--dry-run]  # create a minisite (all features by default)
bun run commonnotes                # website on port 8003 against the PROD backend (.env.prod-backend, gitignored)
bun run commonnotes-local          # website against the local Supabase
bun run commonnotes-dashboard      # analytics dashboard on port 8004 against the PROD backend
bun run commonnotes-dashboard-local
```

`everything-enqueue` is the only way to add content by hand. `--doc <youtube-url> <transcript>` is how to fact-check a podcast from a clean published transcript instead of auto-captions. A paid Substack post shows only a preview in its RSS feed, so the walk never enqueues it. Nathan subscribes to the paid publications, and their full text is enqueued by hand with `--doc <canonical-url> <file>`. Using the post's canonical URL marks it as processed for the walk.

**Never run `everything-auto-run`, `everything-auto-enqueue` or `everything-worker` locally while the CI dispatch is active.** Only one feed worker may run at a time, and the workflow's concurrency group is what guarantees it. A local run bypasses that: its triage sees CI's item as stranded, requeues it, and two workers race on the same claims. Pause the pg_cron job or wait for the run to finish first. The intake service is a second worker that runs all the time, but it only takes the requested tier, so the tiers keep it apart from the feed worker.

### How an item is processed

Every LLM step runs on Meta's Muse Spark 1.3 Contributor (`meta/muse-spark-1.3-contributor`, the constant `EVERYTHING_MODEL` in `src/everything/pipeline/model.ts`), except image descriptions, which stay on Gemini. GPT-6 Luna is the fallback: on 2026-10-01 Meta blocked our access for most of a day, and everything ran on Luna until the block was lifted (GOO-303, GOO-322). Its arms stay in `abTestsData.ts` at weight 0, and llm.ts runs it at medium reasoning effort, so switching back is a change of weights and of `EVERYTHING_MODEL`. The devbox's `muse-probe` messages Jim on Telegram whenever Muse's availability changes. Search is the model provider's own search through OpenRouter's `openrouter:web_search` server tool with `engine: "native"`: one request searches, reads pages and answers, and the cited pages come back as `url_citation` annotations.

`src/everything/pipeline/processContent.ts` drives the steps. Steps 1 to 3 run on the extraction service and step 4 on the claim-check service. The services send records back, and the caller writes the claim rows and the `everything_pipeline_runs` rows.

1. **Gate and split** (`gateAndSplit.ts`): one call decides whether the text tries to shape the reader's beliefs at all. If not, the item is marked done with the reason in `skip_reason`. A reader-requested page is never declined. The same call may split the text into topic parts.
2. **Extraction** (`extractClaims.ts`) pulls the claims out of each part in 12,000-character chunks. The chunk size matters a lot: one call over a whole essay finds far fewer claims. A claim the extractor is very confident is true is stored as skipped with judgement `certainly true`.
3. **Rating** (`rateClaims.ts`) rates all claims of one part in one call on a seven-level scale from certainly true to certainly false. One call per part is deliberate, because one good source often settles many related claims. Only claims rated uncertain or worse are fact-checked (`shouldFactCheck`).
4. **Fact-check**: each remaining claim goes through the X bot's pipeline (simple-bot, with the Common Notes settings) on the claim-check service. Every check writes an `everything_pipeline_runs` row with the outcome, the A/B picks, the full log and the cost. Extraction and rating write rows of their own `kind`. All of them count against the spend cap.

An item stranded in `processing` by a killed run is resumed, not lost. Every claim is saved with its own status before checking starts, so the next run requeues the item and only redoes `pending` and `error` claims. An item killed during extraction, before it had claims, is marked `error`. Each worker triages only its own tier: the feed run at its start for the feed tiers, and the intake service at its own start for the requested tier. Before 2026-10-06 the feed run triaged every tier and marked items the intake service was still extracting as errors. Errored items are retried automatically up to 2 more times, at least 6 hours apart (`retryErroredItems` in `autoEnqueue.ts`), at the lowest tier. After that they need a human.

### Fetching sources

- **YouTube listings** come from the YouTube Data API v3 (`src/pipeline/media/youtubeDataApi.ts`, key `YOUTUBE_DATA_V3_API_KEY`, 10,000 free quota units a day, reset at midnight Pacific time). New uploads are announced by WebSub, the web standard for push notifications that YouTube uses. Google's hub calls our Supabase Edge Function (a small server function hosted by Supabase) `supabase/functions/youtube-websub/`, so a channel is listed again only when it was notified or its last listing is a day old (`src/everything/youtubeChannels.ts`).
- **YouTube captions** go through yt-dlp (`src/pipeline/media/youtubeCaptions.ts`), because the Data API serves captions only to the video's owner. YouTube refuses datacenter IPs, so these calls go through a residential proxy. Every proxied request goes through `withResidentialProxy` in `src/pipeline/utils/residentialProxy.ts`, the only code allowed to read `YTDLP_PROXY_URL` (a test enforces this). The calls use YouTube's web player client, which needs a PO token ("proof of origin", a token showing the request comes from a real player). A local bgutil server on 127.0.0.1:4416 provides one per video. Do not switch to yt-dlp's bgutil plugin: it routes the token request through the proxy, and that path hangs for hours. A caption call that never reached YouTube throws `YoutubeUnreachableError`; it must never be recorded as "no transcript". A fetch lists the video's tracks with one `--dump-single-json` call and then downloads exactly one original track: English first, then the language the video is spoken in, then any other. It never requests a machine translation (a file whose address carries `tlang`), because YouTube answers almost all of those with HTTP 429. On videos YouTube dubbed into other languages, yt-dlp's plain `en` is such a translation and the real English track is `en-orig` (GOO-276).
- **Substack** blocks datacenter IPs. From CI, feeds go through our Cloudflare Worker relay (`src/everything/substack-proxy-worker/`, secrets `SUBSTACK_PROXY_URL` and `SUBSTACK_PROXY_KEY`), which only serves `/feed` reliably. So posts are enqueued with their RSS body as `full_text`. Locally the variables are unset and Substack is fetched directly.
- **LessWrong and the Alignment Forum** use the public ForumMagnum GraphQL API (`src/everything/sources/lesswrong.ts`).
- **Any other page** goes through `fetchWebPage` in `src/pipeline/tool-calling/tools.ts`: several user agents, then the Wayback Machine, archive.ph and headless Chromium. Other sites are never fetched through the proxy, because proxy traffic is paid per GB.

### Data model

`everything_projects → everything_items → everything_claims → everything_notes`, plus `everything_note_sources` (one row per supporting quote), `everything_votes` (retracting deletes the row; `everything_vote_history` keeps every cast, change and retraction of all three vote tables, migration 115), `everything_note_not_needed` and its votes, `everything_note_requests` (reader requests, which the intake service turns into tier-2 items within seconds), `everything_donations`, `everything_events`, `everything_link_visits` (visits), `everything_pipeline_runs` (one row per LLM step with its cost), `everything_passage_highlights` and `everything_passage_questions`, the walk's caches `everything_top_posts` and `everything_youtube_channels`, `everything_slack_announcements` (what cn-notify already posted), and `everything_minisites` with `everything_minisite_jobs` (pages an admin asked the intake service to read for a new minisite, and fact-check wake-ups). A claim stores the highlighted `context_quote`, the wider `context_paragraph`, and `image_urls` when it rests on an image (then `context_quote` may be null). `everything_items.full_text` is the item's body.

The website ships the anon key, so the anon role is locked out of every table except what the public site and the extension need. After a migration, regenerate the frontend's types with `bun run gen-db-types`.

### Minisites

The reader (`src/everything-web/src/reader/`) is a shell plus one module per feature (`reader/features/`). Each module fills named slots: buttons on selected words, buttons under a passage, entries in the margin, a rail, dialogs. A feature added later starts off on existing minisites. The old `/read?url=` page is gone; its two articles are the minisites `big-tent-or-small-tent` and `white-house-accord`. Creating a minisite: the website writes a `read_page` job, the intake service reads the page through `cn-fetch` without fact-checking it, and `everything_create_minisite` makes the minisite. The fact-check is a separate admin button (`everything_start_minisite_check`), which queues the article at the reader-request tier and keeps its text. On a minisite, Ask Opus gets only the tools its features allow and never `request_note`.

### Website, voting and donations

- Reading needs no account. When a reader first votes or writes a note, `ensureUser()` in `everything-core/auth.ts` silently creates an anonymous Supabase account, and a later sign-in upgrades that account in place and keeps its votes and notes. A browser that has signed in before gets the sign-in form instead. Sign-in is an emailed 6-digit code (`signInWithEmailCode` then `verifyEmailCode`) or X. There are no magic links. User notes post directly without an LLM check; moderation is votes and the author's own delete.
- X sign-in redirects back to the origin the user came from only if that origin is on the Supabase project's redirect allow-list; otherwise Supabase silently uses the Site URL. The local list is in `supabase/config.toml`. The prod list is set in the Supabase dashboard and must include the localhost origins to test X sign-in locally against prod. Every production setting made by hand outside the code (Supabase dashboard, Vault, pg_cron jobs, GitHub secrets, Cloudflare, stores, X apps) is recorded in `docs/prod-config.md`; update it when you change one.
- `noteStatus` in `everything-core/noteScore.ts` is the one rule that decides a note's badge, its place in the feed, and which side of a donation pays out. Change it only there.
- Every vote on someone else's note records a donation pair: $X if the note ends up rated helpful, $Y if not, frozen at vote time (`everything-core/donationScoring.ts`). The derivation and the reference Python model, which is the source of truth for that formula, are in `src/scripts_jim/2026_07_21_donation_decay/`. The team pays donations out by hand.
- Feed ordering is `rankFeed` in `everything-web/src/lib/feed.ts`.

### Analytics

Metrics come from the `everything_*` tables wherever the database already records the fact. Events exist only where the database is blind, as rows in `everything_events`, whose event names are whitelisted by a CHECK constraint. Before adding an event, check whether a table already records it; a new event needs a migration for the whitelist. Code calls `track()` from `everything-core/analytics.ts`. The dashboard (`src/analytics-dashboard/`) reads aggregates through database functions marked `SECURITY DEFINER`, which run with their owner's rights, because the anon key can never read raw events. Charts use visx.

## Common Notes frontend layers

The website and the extension are built from three shared layers. Each may only import from the layers below it, and ESLint enforces that (`bun run lint`, part of `bun run check` and CI):

- `@cn/core` (`src/everything-core/`) - data access, types, scoring math, URL helpers. No React. The only layer that imports the Supabase client, which is typed by `database.types.ts`. Its data functions throw on failure. The pipeline also imports a few of its pure modules.
- `@cn/ui` (`src/everything-ui/`) - the design system, which knows nothing about notes. `tokens.css` holds every design value as a CSS variable: a primitive palette, then semantic roles (`fg-muted`, `surface`, `line`, `positive`, ...) that dark mode swaps. The shared Tailwind preset exposes only those semantic names, so Tailwind's own palette classes such as `bg-blue-600` generate no CSS, and colours need no `dark:` variants.
- `@cn/features` (`src/everything-features/`) - what both apps show: the note card, the donation notice, the session hook and the login prompt.

Server data flows through TanStack Query (a React library that caches server responses under query keys). Components never call `fetch` themselves; they use hooks such as `useMyVotes` or `useVoteOnNote`, or `useQuery` around a `@cn/core` function, and mutations update the cache. Notes are cached as a `NoteSet` under the `noteSet` key prefix, so a vote anywhere updates the note everywhere. The two apps never import from each other. A layer must be imported through its `@cn/...` alias; a relative path into another layer is a lint error. The aliases are defined in `src/cnAliases.ts` for the bundlers and repeated in `tsconfig.json`.

`bun run storybook` serves Storybook on port 8005. Stories sit next to their component as `*.stories.tsx` and never reach a backend: `src/everything-storybook/fixtures.ts` holds fictional data seeded into the query cache. There are page mocks of a Substack post and a YouTube watch page that run the extension's real code.

## Browser extension

`src/everything-extension/` is a WXT extension for Chrome, Firefox and Safari. What a reader sees, and the product decisions behind it that must not be "fixed" back, are in `docs/extension-behaviour.md`. Read it before changing reader-facing behaviour, and update it when you change that behaviour. It finds the `everything_items` row for the page, fetches its notes, and anchors each claim's quote to the page text by fuzzy matching (`utils/anchor.ts`). Its UI lives in shadow roots, so it never touches the host page's styles. The host page's root font size still leaks into shadow roots (YouTube sets 10px), so the build turns every `rem` into `px` at 16px per rem.

```bash
bun run dev-ext            # dev mode against PROD (load .output/chrome-mv3-prod-backend unpacked)
bun run dev-ext-local      # dev mode against the local Supabase (.output/chrome-mv3)
bun run build-ext-dev      # dev build against PROD with the self-reload hook: what Jim's Mac runs
bun run build-ext-safari-dev
bun run build-ext          # Chrome, Firefox and Safari production builds
bun run zip-ext            # store zips
```

**Deliver every extension change to Jim's Mac Chrome without being asked.** Jim works on this VPS but judges changes in his real browser.
1. `bun run build-ext-dev`. Never plain `build-ext`, because only the dev build has the self-reload poller and the build id.
2. Point the symlink `~/dev/ext-build` at your worktree's `src/everything-extension/.output/chrome-mv3-prod-backend` (`ln -sfn`). Before deleting a worktree it points into, point it back at a surviving checkout with a fresh build.
3. Run `~/.local/bin/cn-ext-push`. The dev build reloads itself within 30 seconds when a newer build lands.

Quote the push output and tell Jim the build id (HH:MM:SS). A freshly loaded page logs it at debug level as `[common-notes] dev build <id>`, and every open tab carries the running background's id as `data-cn-dev-build-bg` on `<html>`. Open tabs keep their old content scripts until refreshed, so tell Jim to refresh. Never run `cn-ext-push --verify` without asking: it opens a tab and pulls focus to Chrome on Jim's laptop.

For Safari, run `bun run build-ext-safari-dev`, then `cn-ext-push --safari <worktree>/src/everything-extension`, which builds the container app on the Mac. Safari loads the locally signed app only while "Allow unsigned extensions" is on, and Safari turns it off on every quit.

To check a change visually on the devbox: `bun run src/everything-extension/scripts/preview.ts <url> <out.png>` opens the page in headless Chromium with the built extension and takes a screenshot. On machines without Chromium's system libraries, the libraries extracted into `~/.cache/cn-playwright-libs` are put on the library path by the launcher itself.

Things that are easy to get wrong:
- **Host-page shortcuts**: every piece of UI the extension puts into a page mounts through `createOverlayUi` (`utils/overlayUi.ts`), which stops key events at the overlay's shadow root. Outside the shadow root a key typed in our text field looks to the page like a key pressed on the page itself, so YouTube's and Substack's single-key shortcuts would fire. ESLint forbids calling WXT's `createShadowRootUi` directly.
- **Firefox content scripts** wrap page objects in "Xray" wrappers. The iterator protocol on `URLSearchParams` does not exist there (use `forEach`), and `navigator.locks` returns Promises the sandbox may not touch (the shared Supabase client passes its own auth `lock`). Chrome has neither problem.
- **Safari** (`src/everything-extension/safari/`, an Xcode container app) ignores the install-time `<all_urls>` grant, has no `identity` API (so no X sign-in), and treats `storage.sync` like local storage. Code that must differ reads `import.meta.env.SAFARI`.
- **Auth** is one Supabase session stored in `chrome.storage.local`, because a content script's localStorage belongs to the host page. `autoRefreshToken` is off since Manifest V3 service workers lose their timers; `getSession()` refreshes on demand.
- **Sites**: Substack and YouTube are injected by default. Every other site with notes is registered at runtime by the background's sync (`scripting.registerContentScripts`), so a new site reaches existing installs without a store update. Content scripts check a locally cached list of covered pages before any backend call.
- **Data collection**: visit recording stays off until the reader has seen the welcome page (`cn:welcomeSeen`), and it obeys the per-site checkboxes on the settings page.
- **Settings** writes store only the keys the reader changed (`patchSyncObject` in `utils/settings.ts`), so a changed default reaches everyone who never touched that setting.
- The extension IDs are pinned (Chrome by the manifest `key`, Firefox by `gecko.id` = `extension@commonnotes.net`), so the X sign-in redirect URLs are fixed. Never delete an AMO listing: the old Firefox id was permanently burned that way.

## Review dashboard

`bun run review` (prod) or `bun run review-local` serves it on port 8001 and frees the port first.

## Trending posts

The `Trending Posts` workflow runs `bun run trending-posts` (`src/production/postTrendingPosts.ts`) once a day at 13:00 UTC, 6am in California in summer. For each topic of Nathan Young's crowd, one `grok-4.3` call with Grok's `x_search` tool, limited to posts from yesterday and today, finds posts that went viral there and are about an article or blog post. Each topic with new posts becomes one Slack message in #trending-posts. The table `trending_posts` remembers every post already posted, so none is posted twice. It requests no Common Notes, because too many of the posts are false positives for that. `--dry-run` prints the messages instead. The investigation behind it is in `src/scripts_jim/2026_10_01_article_traction/` (GOO-289).

## Database

Schema changes live in `migrations/`; the X bot's queries and types are in `src/api/supabaseClient.ts`. Use `notes` for performance analysis and submission metadata, and `pipeline_runs` plus `pipeline_scores` for debugging.

## Notewriter scraper

`bun run scrape` (`src/scraper/scrapeNotewriterClickThrough.ts`) connects to a local Chrome over the DevTools protocol on port 9222, scrolls X's notewriter page for the account `wholesome-raspberry-stilt`, and opens each note's details to read its real id and status. It adds missing `notes` rows as it goes and writes one `scraped_notewriter_snapshots` row per note seen. At the end, `reconcileSnapshots.ts` derives each note's final values from its snapshots. It is set up for Jim's Mac: it starts Chrome with `open` when nothing listens on port 9222, the Chrome profile `~/.chrome-debug-profile` must be logged into X, and the daily LaunchAgent has Mac paths hard-coded.

```bash
bun run scrape                             # 500 notes
bun run scrape 5000 --fresh                # full pass from the top
bun run scrape 5000 --start-from <noteId>  # resume
bun run scrape --incremental               # daily mode, run by scripts/run-daily-scrape.sh from the LaunchAgent
```

X's notewriter page scrolls `document.documentElement`, not the window, and only renders 5 to 10 cells at a time, so Ctrl+F does not work.

## Standing permissions

- **Scraper**: Claude can start the scraper at any time without asking. Ask before stopping it.

## Gotchas

- Do not delete database rows without confirming.
- Supabase's API returns at most 1,000 rows per request and does not say when it cut a result short. Every read that can return more than a handful of rows goes through `fetchAllRows` or `fetchInBatches` in `src/everything-core/paging.ts`. That includes `rpc()` calls that return rows, and `.in()` lists longer than about 200 values, whose URL gets too long. Only `.single()`, `.maybeSingle()` and a deliberately small `.limit()` are safe without it. `fetchAllRows` pages by a unique key, so read its rules before using it: the query you hand it must not call `.order()`.
- Community Notes reports `currentStatus` (overall) and `currentCoreStatus` (core model only, can be empty). Always use the overall status to decide whether a note is helpful. In our `notes` table that column is `cn_status`.

## Running locally

```bash
bun install
bun run src/production/runPipeline.ts --local   # the X pipeline against the local Supabase, never submits
```

`--local` points Supabase at `LOCAL_SUPABASE_URL` and swaps the X keys for the `LOCAL_X_*` test account, and it only dry-runs the submission. Without `--local`, `runPipeline.ts` is the production run: it writes to the prod database and submits real notes. Never run it that way, and never submit notes or change anything on the account with the prod X keys, without Jim's explicit approval.

### Replay a prod run (`tryoutNotes --from-db`)

```bash
bun run src/local/tryoutNotes.ts <tweet-id> --from-db          # reuse the tweet, redo everything else
bun run src/local/tryoutNotes.ts <tweet-id> --from-db input    # also reuse the input (comments, media, author history)
bun run src/local/tryoutNotes.ts <tweet-id> --from-db note     # also reuse the note: only the note-needed judge and source verifier run again
```

It reads the latest `pipeline_runs` row for the tweet from prod, seeds the local caches from its logs (`src/local/seedReplayFromDb.ts`), and writes its own results to the local Supabase. It uses `--bot simple-bot` unless you pass `--bot`.
