# Notewriter Scraper

Scrapes note data from the X/Twitter Community Notes notewriter page.

## Why a scraper?

The notewriter page (`x.com/i/communitynotes/u/[username]`) uses a virtualized list that only renders visible items. This means:
- Ctrl+F doesn't work
- Copy/paste doesn't capture URLs
- "View details" is a button (not a link), so note IDs aren't easily accessible

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

## Database tables

- `scraped_notewriter_notes` - One row per note (immutable core data)
- `scraped_notewriter_snapshots` - Time-series tracking (new row each scrape)

## Verifying data

After import, check notes with views in Supabase:

```sql
SELECT
  n.note_id,
  LEFT(n.note_text, 80) as note_preview,
  s.view_count,
  s.cn_status
FROM scraped_notewriter_notes n
JOIN scraped_notewriter_snapshots s ON n.note_id = s.note_id
WHERE s.view_count IS NOT NULL
ORDER BY s.view_count DESC;
```

To open tweets for manual verification:

```js
// In browser console after scraping
const withViews = [..._scraper.notes.values()].filter(n => n.view_count);
withViews.slice(0, 5).forEach(n => window.open(n.tweet_url, '_blank'));
```
