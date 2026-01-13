# Notewriter Scraper

Scrapes note data from the X/Twitter Community Notes notewriter page.

## Why a scraper?

The notewriter page (`x.com/i/communitynotes/u/[username]`) is hard to work with manually:
- Virtualized list (only renders visible items) breaks Ctrl+F
- Copy/paste doesn't capture URLs
- "View details" is a button not a link, so note IDs aren't accessible from the list

## Usage

1. Go to `x.com/i/communitynotes/u/[your-username]`
2. Open DevTools console (F12)
3. Paste `browser-notewriter-scraper.js` and press Enter
4. It auto-scrolls and collects notes
5. When done, JSON is copied to clipboard

### Commands

```js
_scraper.stop()    // Stop early
_scraper.export()  // Get JSON of current data
_scraper.verify()  // List notes with view counts
_scraper.search("text")  // Scroll to find a note
```

## What it extracts

- `tweet_id` - ID of the tweet the note is on
- `note_id` - Community Notes ID (when available)
- `note_text` - The note content
- `cn_status` - Current status (CURRENTLY_RATED_HELPFUL, NEEDS_MORE_RATINGS, etc.)
- `view_count` - Only present on notes that reached "helpful" status
- `source_url` - External links cited in the note

## Importing to database

Save the JSON output to a file, then run:

```bash
npx tsx src/scripts/importNotewriterData.ts ./scraped-notes.json
```

This upserts to `scraped_notewriter_notes` and inserts a snapshot to `scraped_notewriter_snapshots`.

## Database

See `migrations/004_create_scraped_notewriter_tables.sql` for schema.
