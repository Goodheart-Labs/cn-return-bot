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
- `scraped_notewriter_notes` - All notes scraped from notewriter page (back to Aug 2025). Older entries have placeholder note_ids like `tweet_XXXXX`
- `scraped_notewriter_snapshots` - Point-in-time status/view counts for scraped notes
- `pipeline_runs` - Every tweet processed, with outcome (submitted/filtered/failed/rejected)
- `pipeline_scores` - Scores attached to pipeline runs
- `notewriters` - Notewriter accounts
- `bot_configs` - Bot configurations
- `public_data_snapshots` - Daily snapshots from X's public CN data dumps (our notes + competing notes)

## Notewriter scraper

To scrape view counts from the Community Notes notewriter page, see `scripts/README.md`. Data goes into `scraped_notewriter_notes` and `scraped_notewriter_snapshots` tables.

## Gotchas

- OpenRouter model IDs use dots: `anthropic/claude-opus-4.5` not `claude-opus-4-5-20251101`
- GitHub Actions uses bun, not npm
- The notewriter page virtualizes its list - can't Ctrl+F, need the scraper

## Running locally

```bash
bun install
bun run src/scripts/createNotesRoutine.ts
```
