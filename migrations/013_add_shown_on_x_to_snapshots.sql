-- Add shown_on_x column to track whether the note displays "Shown on X" or "Not shown on X"
-- null = scraper didn't detect either string, true = "Shown on X", false = "Not shown on X"
ALTER TABLE scraped_notewriter_snapshots
ADD COLUMN IF NOT EXISTS shown_on_x boolean;
