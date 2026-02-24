# CLAUDE.md

Project context for Claude Code sessions.

## What this is

A bot that automatically writes Community Notes for X/Twitter posts. Runs on GitHub Actions every 30 minutes. Posts using X note writing API. There are several bots that are writing and then predicting the outcome of their writing.

## Aim

To deliver a billion impressions of community notes, or equivalent by then end of 2026. 

## Tech stack

- TypeScript, Bun
- OpenRouter for LLM calls (uses Openrouter `anthropic/claude-opus-4.6` format, NOT Anthropic API format)
- Supabase for data storage
- Playwright for browser automation for scraping to get feedback on notes

## Key directories

- `src/bots/` - Bot configurations (opus-main, multi-search)
- `src/pipeline/` - Core logic: search, note writing, checking
- `src/scripts/` - 
- `migrations/` - Supabase SQL migrations
- `scripts/` - Browser console scripts (see below)

## Database tables (Supabase)

- `notes` - Bot-submitted notes with tracking (since Jan 7, 2026)
- `canonical_note_information` - Bot-written notes scraped back from the notewriter page for tracking (back to Aug 2025). Older entries have placeholder note_ids like `tweet_XXXXX`
- `scraped_notewriter_snapshots` - Point-in-time status/view counts for our bot-written notes (from scraping)
- `pipeline_runs` - Every tweet processed, with outcome (submitted/filtered/failed/rejected)
- `pipeline_scores` - Scores attached to pipeline runs
- `notewriters` - Notewriter accounts
- `bot_configs` - Bot configurations
- `public_data_snapshots` - Daily snapshots from X's public CN data dumps (our notes + competing notes)

## Notewriter scraper

The main scraper is `src/scripts/scrapeNotewriterClickThrough.ts`. It connects to a local Chrome via Puppeteer CDP (port 9222), scrolls through the notewriter page, clicks "View details" on each note to extract the real note ID and status from the modal, then imports to Supabase. When it breaks, we can rejoin from the same position. 

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
bun run src/scripts/scrapeNotewriterClickThrough.ts 50
bun run src/scripts/scrapeNotewriterClickThrough.ts 50 --fresh  # reload page first
```

## Standing permissions

- **Scraper**: Claude can start the scraper at any time without asking. Use `~/.bun/bin/bun run src/scripts/scrapeNotewriterClickThrough.ts` with appropriate flags. Ask before stopping it. 

## Gotchas

- OpenRouter model IDs use dots: `anthropic/claude-opus-4.5` not `claude-opus-4-5-20251101`
- GitHub Actions uses bun, not npm
- The notewriter page virtualizes its list - can't Ctrl+F, need the scraper
- After compacting, ask Nathan what to do next. 
- Do not delete database enries without confirming. 
- Common error for supabase to only display the first 1000. Make sure you are getting them all.

## Running locally

```bash
bun install
bun run src/scripts/createNotesRoutine.ts
```
