# CLAUDE.md

Project context for Claude Code sessions.

## What this is

A bot that automatically writes Community Notes for X/Twitter posts. Runs on GitHub Actions every 30 minutes.

## Tech stack

- TypeScript, Bun
- OpenRouter for LLM calls (uses `anthropic/claude-opus-4.5` format, NOT Anthropic API format)
- Supabase for data storage
- Playwright for browser automation

## Key directories

- `src/bots/` - Bot configurations (opus-main, multi-search)
- `src/pipeline/` - Core logic: search, note writing, checking
- `src/scripts/` - One-off scripts (createNotesRoutine.ts is the main entry)
- `migrations/` - Supabase SQL migrations
- `scripts/` - Browser console scripts (see below)

## Database tables (Supabase)

- `notes` - Bot-submitted notes with tracking (since Jan 7, 2026)
- `scraped_notewriter_notes` - Bot-written notes scraped back from the notewriter page for tracking (back to Aug 2025). Older entries have placeholder note_ids like `tweet_XXXXX`
- `scraped_notewriter_snapshots` - Point-in-time status/view counts for our bot-written notes (from scraping)
- `pipeline_runs` - Every tweet processed, with outcome (submitted/filtered/failed/rejected)
- `pipeline_scores` - Scores attached to pipeline runs
- `notewriters` - Notewriter accounts
- `bot_configs` - Bot configurations
- `public_data_snapshots` - Daily snapshots from X's public CN data dumps (our notes + competing notes)

## Notewriter scraper

Scrapes our own bot-written notes from the notewriter page to track status changes and view counts over time. See `scripts/README.md` for usage. Data goes into `scraped_notewriter_notes` and `scraped_notewriter_snapshots` tables.

To run the scraper, just run it directly — Chrome with remote debugging will already be available or will launch automatically. Don't ask the user to manually navigate to the notewriter page.

```bash
bun run src/scripts/scrapeNotewriterClickThrough.ts 20
```

## Gotchas

- OpenRouter model IDs use dots: `anthropic/claude-opus-4.5` not `claude-opus-4-5-20251101`
- GitHub Actions uses bun, not npm
- The notewriter page virtualizes its list - can't Ctrl+F, need the scraper

## Running locally

```bash
bun install
bun run src/scripts/createNotesRoutine.ts
```
