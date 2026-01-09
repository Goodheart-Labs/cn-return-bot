# Manual Import of Scraped Community Notes

This guide explains how to manually import Community Notes data that you've scraped from X.com into Supabase for tracking and analysis.

## Why Manual Import?

- **View count tracking**: Update view counts for notes created by your bots
- **Historical tracking**: Track how your notes perform over time
- **Discovery**: Find and log notes that might be from others or before tracking started

## Quick Start

1. **Create a JSON file** with your scraped notes (see template below)
2. **Run the import script**:
   ```bash
   tsx src/scripts/importScrapedNotes.ts ./your-scraped-notes.json
   ```

## How It Works

The import script has **two behaviors**:

### 1. Matched Notes (exist in database)
- **Updates** the note with new view count and status
- Logs changes to `note_status_history` table for tracking over time
- These are notes your bot created that are now being updated with fresh data

### 2. Unmatched Notes (NOT in database)
- **Logs to separate table** `unmatched_scraped_notes`
- These are likely notes created by other contributors or before your tracking started
- Useful for discovering what other notes exist on tweets you're monitoring

## JSON File Format

### Template Structure

```json
{
  "import_date": "2026-01-09",
  "description": "Description of this import batch",
  "notes": [
    {
      "note_id": "1234567890",
      "tweet_id": "9876543210",
      "note_text": "Full text of the community note",
      "cn_status": "CURRENTLY_RATED_HELPFUL",
      "view_count": 3300,
      "source_url": "https://example.com/source"
    }
  ]
}
```

### Required Fields

- **`note_id`**: The Community Note ID from X.com
- **`tweet_id`**: The tweet/post ID that the note is attached to
- **`note_text`**: The full text of the community note

### Optional Fields

- **`cn_status`**: Current status (`CURRENTLY_RATED_HELPFUL`, `NEEDS_MORE_RATINGS`, `NOT_SHOWN_ON_X`)
- **`view_count`**: Number of views the note has received
- **`source_url`**: The URL cited in the note

## How to Extract Data from X.com

### Finding Note and Tweet IDs

You'll need to manually extract these from X.com. Here's where to find them:

1. **Tweet ID**: In the tweet URL: `https://x.com/username/status/[TWEET_ID]`
2. **Note ID**: In the note details or from browser inspector tools

### Scraping a Note - Example

For this note on X.com:
```
Currently rated helpful
Jan 1 · View details
Shown on X · 3,300+ views
The post incorrectly characterizes the Bills as "cheap"...
```

Extract:
- **`cn_status`**: `"CURRENTLY_RATED_HELPFUL"`
- **`view_count`**: `3300`
- **`note_text`**: The full note text
- **`note_id`** and **`tweet_id`**: From the URLs/page source

## Script Behavior

###For Matched Notes (in your database)
- Updates `cn_status` if provided
- Updates `view_count` if provided
- Updates `views_last_updated_at` timestamp
- Updates `last_checked_at` timestamp
- Logs to `note_status_history` for tracking changes

### For Unmatched Notes (NOT in your database)
- Creates entry in `unmatched_scraped_notes` table
- Records: note_id, tweet_id, note_text, cn_status, view_count, source_url
- Allows you to discover notes from other contributors

## Database Setup

Before using the import script, run the migration to create the unmatched notes table:

```sql
-- Run this SQL in your Supabase SQL editor
-- Or save to a migration file
\i migrations/003_create_unmatched_scraped_notes.sql
```

This creates:
- **`unmatched_scraped_notes`** table for tracking notes not in your system
- Indexes for efficient querying by tweet_id, status, and discovery date

## Examples

### Example 1: Update View Counts for Your Notes

You scraped current stats for 5 of your bot's notes:

```json
{
  "import_date": "2026-01-09",
  "description": "Weekly view count update",
  "notes": [
    {
      "note_id": "1234567890",
      "tweet_id": "9876543210",
      "note_text": "...",
      "view_count": 5800,
      "cn_status": "CURRENTLY_RATED_HELPFUL"
    }
  ]
}
```

Output:
```
✓ Updated existing note
✓ Logged to status history
- View count: 5800
- Status: CURRENTLY_RATED_HELPFUL
```

### Example 2: Discover Other Contributors' Notes

You found a note on a tweet but it's not yours:

```json
{
  "import_date": "2026-01-09",
  "description": "Found someone else's note on a tweet we monitor",
  "notes": [
    {
      "note_id": "9999999999",
      "tweet_id": "1111111111",
      "note_text": "This claim is misleading...",
      "cn_status": "NEEDS_MORE_RATINGS"
    }
  ]
}
```

Output:
```
⚠ Note not in database - logged as unmatched
- This note was likely created by someone else or before tracking started
```

## Tips

1. **Use the template**: Start with `scraped-notes-template.json` and modify it
2. **Validate JSON**: Use a JSON validator before importing
3. **Test with one note first**: Verify the process works
4. **Keep your JSON files**: Store them for record-keeping
5. **Regular updates**: Scrape and import view counts weekly to track growth
6. **Check unmatched notes**: Periodically review `unmatched_scraped_notes` to see what others are contributing

## Troubleshooting

### "Missing note_id" error
- Ensure every note has all required fields: `note_id`, `tweet_id`, `note_text`

### "Missing Supabase credentials" error
- Check your `.env` file has `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`

### "Table unmatched_scraped_notes does not exist"
- Run the migration: `migrations/003_create_unmatched_scraped_notes.sql`

### Note IDs are hard to find
- Use browser developer tools (F12)
- Look at network requests when viewing a note
- Check the page HTML source

## Files

- **Template**: `scraped-notes-template.json` - Clean template to copy
- **Example**: `scraped-notes-jan-9-2026.json` - Real examples (fill in note_id/tweet_id)
- **Script**: `src/scripts/importScrapedNotes.ts` - The import script
- **Migration**: `migrations/003_create_unmatched_scraped_notes.sql` - Database schema
- **Types**: `src/api/supabaseClient.ts` - Database types and methods
