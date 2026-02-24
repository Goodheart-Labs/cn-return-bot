-- Add rater_tags to track "Top tags selected by raters" from note modals
-- e.g. ["Cites high-quality sources", "Easy to understand"]
ALTER TABLE scraped_notewriter_snapshots
ADD COLUMN IF NOT EXISTS rater_tags text[];

ALTER TABLE scraped_notewriter_notes
ADD COLUMN IF NOT EXISTS rater_tags text[];
