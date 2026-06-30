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
- `src/review-dashboard/` - React dashboard for reviewing note failures
- `src/scripts_jim/` - Jim's investigation journal (Python, by date)
- `src/scripts_nathan/` - Nathan's investigation scripts (by date)
- `migrations/` - Supabase SQL migrations

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
