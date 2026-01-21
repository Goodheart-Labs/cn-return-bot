-- Create a view that joins notes with their latest scraped snapshot
-- This provides a single source of truth for querying note data:
-- - status: from notes.cn_status (public data) OR fallback to latest snapshot
-- - views: always from latest snapshot (only source)

-- First, create a helper view that gets the latest snapshot per note
CREATE OR REPLACE VIEW latest_scraped_snapshots AS
SELECT DISTINCT ON (note_id)
  note_id,
  cn_status as snapshot_status,
  view_count as snapshot_views,
  helpful_count as snapshot_helpful,
  not_helpful_count as snapshot_not_helpful,
  scraped_at as snapshot_scraped_at
FROM scraped_notewriter_snapshots
ORDER BY note_id, scraped_at DESC;

-- Main view: notes enriched with latest snapshot data
CREATE OR REPLACE VIEW notes_with_snapshot AS
SELECT
  n.id,
  n.note_id,
  n.tweet_id,
  n.notewriter_id,
  n.bot_config_id,
  n.bot_name,
  n.note_text,
  n.source_url,
  n.evaluation_score,
  n.commit_sha,
  n.submitted_at,

  -- Status: prefer notes.cn_status (from public data), fallback to snapshot
  COALESCE(n.cn_status, s.snapshot_status) as effective_status,
  n.cn_status as public_data_status,
  s.snapshot_status,

  -- Views: always from snapshot (only source)
  s.snapshot_views as view_count,
  s.snapshot_scraped_at as views_updated_at,

  -- Rating counts from snapshot
  s.snapshot_helpful as helpful_count,
  s.snapshot_not_helpful as not_helpful_count,

  -- Timestamps
  n.first_helpful_at,
  n.last_checked_at,
  s.snapshot_scraped_at as last_scraped_at,

  -- Metadata flags
  CASE
    WHEN s.note_id IS NULL THEN false
    ELSE true
  END as has_snapshot,
  CASE
    WHEN n.cn_status IS NOT NULL THEN 'public_data'
    WHEN s.snapshot_status IS NOT NULL THEN 'snapshot'
    ELSE 'unknown'
  END as status_source

FROM notes n
LEFT JOIN latest_scraped_snapshots s ON n.note_id = s.note_id;

-- Add comments
COMMENT ON VIEW latest_scraped_snapshots IS 'Latest scraped snapshot for each note_id';
COMMENT ON VIEW notes_with_snapshot IS 'Notes enriched with latest scraped snapshot data. Use effective_status for status, view_count for views.';
