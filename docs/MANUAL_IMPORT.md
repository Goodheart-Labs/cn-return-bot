# Manual Import of Scraped Community Notes

This guide explains how to manually import Community Notes data that you've scraped from X.com into Supabase for tracking and analysis.

## Why Manual Import?

- **Historical data**: Import notes that were created before Supabase logging was implemented
- **View count tracking**: Update view counts for notes that are already in the system
- **Data recovery**: Re-import notes if there was a logging failure
- **Manual scraping**: When you manually scrape note data from X.com

## Quick Start

1. **Create a JSON file** with your scraped notes (see template below)
2. **Run the import script**:
   ```bash
   tsx src/scripts/importScrapedNotes.ts ./your-scraped-notes.json
   ```

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
      "note_text": "Full text of the community note including source URL",
      "cn_status": "CURRENTLY_RATED_HELPFUL",
      "view_count": 3300,
      "bot_name": "opus-main",
      "source_url": "https://example.com/source",
      "submitted_at": "2026-01-01T12:00:00Z"
    }
  ]
}
```

### Required Fields

- **`note_id`**: The Community Note ID from X.com (found in the note URL or details)
- **`tweet_id`**: The tweet/post ID that the note is attached to
- **`note_text`**: The full text of the community note

### Optional Fields

- **`cn_status`**: Current status of the note (e.g., `CURRENTLY_RATED_HELPFUL`, `NEEDS_MORE_RATINGS`, `NOT_SHOWN_ON_X`)
- **`view_count`**: Number of views the note has received
- **`bot_name`**: Which bot created this note (e.g., `opus-main`, `gemini-flash`, `manual-scrape`)
- **`source_url`**: The URL cited in the note
- **`submitted_at`**: When the note was submitted (ISO 8601 format)

## How to Extract Data from X.com

### Finding Note IDs

When viewing a Community Note on X.com, you can find the note ID in several ways:

1. **From the note details page**: The URL will contain the note ID
2. **From the browser inspector**: Look at the data attributes in the HTML
3. **From the API response**: If you're using browser dev tools to inspect network requests

### Example: Scraping a Note

For this note on X.com:
```
Currently rated helpful
Jan 1 · View details
Shown on X · 3,300+ views
The post incorrectly characterizes the Bills as "cheap"...
```

Extract:
- **`cn_status`**: `"CURRENTLY_RATED_HELPFUL"` (from "Currently rated helpful")
- **`view_count`**: `3300` (from "3,300+ views")
- **`submitted_at`**: `"2026-01-01T00:00:00Z"` (from "Jan 1")

You'll need to manually find the `note_id` and `tweet_id` from the page source or URL.

## Script Behavior

### For New Notes (not in database)
- Creates a new note record
- Sets all provided fields
- Defaults `bot_name` to `"manual-scrape"` if not provided
- Logs to status history if status or view count provided

### For Existing Notes (already in database)
- Updates `cn_status` if provided
- Updates `view_count` if provided
- Updates `views_last_updated_at` timestamp
- Updates `last_checked_at` timestamp
- Logs to status history to track changes over time

## Examples

### Example 1: Import Historical Notes

You have 10 notes from before Supabase was set up:

```bash
# Create scraped-historical.json with your notes
tsx src/scripts/importScrapedNotes.ts ./scraped-historical.json
```

Output:
```
[importScrapedNotes] Starting manual import...
[importScrapedNotes] Found 10 notes to import
...
[importScrapedNotes] Import complete!
  - Created: 10 notes
  - Updated: 0 notes
  - Errors: 0 notes
```

### Example 2: Update View Counts

You want to update view counts for existing notes:

```json
{
  "import_date": "2026-01-09",
  "description": "View count update - weekly scrape",
  "notes": [
    {
      "note_id": "1234567890",
      "tweet_id": "9876543210",
      "note_text": "...",
      "view_count": 5800
    }
  ]
}
```

The script will:
1. Find the existing note
2. Update the view count from old value to 5800
3. Log the change to `note_status_history` table
4. Update the `views_last_updated_at` timestamp

## Tips

1. **Use the template**: Start with `scraped-notes-template.json` and modify it
2. **Validate JSON**: Use a JSON validator to check your file before importing
3. **Test with one note first**: Import a single note to verify everything works
4. **Keep your JSON files**: Store them for record-keeping and re-imports if needed
5. **Regular updates**: For active notes, scrape and import view counts regularly to track growth

## Troubleshooting

### "Missing note_id" error
- Make sure every note has a `note_id` field
- The note ID should be a string of digits

### "Missing Supabase credentials" error
- Ensure your `.env` file has `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
- Load environment variables: `source .env` (bash) or check your shell config

### "Error inserting scraped note"
- Check that your `note_text` isn't too long (database limits)
- Verify the `submitted_at` date is in ISO 8601 format
- Check the Supabase error message for specific details

## Files

- **Template**: `scraped-notes-template.json` - Copy and modify this
- **Example**: `scraped-notes-jan-9-2026.json` - Real example with your notes
- **Script**: `src/scripts/importScrapedNotes.ts` - The import script
- **Types**: `src/api/supabaseClient.ts` - Database types and methods
