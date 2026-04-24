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
# Production Supabase
lsof -ti:8001 | xargs kill -9 2>/dev/null; bun run build-review && bun run serve-review

# Local Supabase
lsof -ti:8001 | xargs kill -9 2>/dev/null; cd src/review-dashboard && bunx vite build && cd ../.. && bun run src/review-dashboard/server.ts --local
```

## Database

See [DATABASE.md](docs/DATABASE.md) for full schema, column descriptions, enum values, and data flow. See [community-notes-data.md](docs/community-notes-data.md) for X's public Community Notes data schema.

Quick guide: use `canonical_note_information` for performance analysis, `notes` for submission metadata, `pipeline_runs` + `pipeline_scores` for debugging.

## Notewriter scraper

The main scraper is `src/scraper/scrapeNotewriterClickThrough.ts`. It connects to a local Chrome via Puppeteer CDP (port 9222), scrolls through the notewriter page, clicks "View details" on each note to extract the real note ID and status from the modal, then imports to Supabase. When it breaks, we can rejoin from the same position. 

- **Notewriter account**: `wholesome-raspberry-stilt` (the only active one)
- **Primary purpose**: Full coverage audit — ensure every note we've written is tracked in the DB
- **Data destination**: `canonical_note_information` + `scraped_notewriter_snapshots` tables
- **Key technical detail**: X's notewriter page scrolls on `document.documentElement` (the `<html>` element), NOT window or body. The virtualizer only renders ~5-10 cells at a time.
- **One scraper**: Only `scrapeNotewriterClickThrough.ts` exists. Legacy scrapers were deleted Feb 2026.

Usage:
```bash
# Start Chrome with remote debugging first
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile

# Run scraper (number = max notes to scrape)
bun run src/scraper/scrapeNotewriterClickThrough.ts 50
bun run src/scraper/scrapeNotewriterClickThrough.ts 50 --fresh  # reload page first
```

## Standing permissions

- **Scraper**: Claude can start the scraper at any time without asking. Use `~/.bun/bin/bun run src/scraper/scrapeNotewriterClickThrough.ts` with appropriate flags. Ask before stopping it.

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
