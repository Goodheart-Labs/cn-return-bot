-- Backfill tweets rows for any note whose tweet_id has no row in tweets yet,
-- and add the FK from pipeline_runs.note_id → notes.note_id.
--
-- Why the backfill:
-- Migration 032 populated tweets only from pipeline_runs (the rows we
-- processed locally). But there are notes — both pre-tracking ones and ones
-- discovered via the X-API overlay in updateNoteFeedback.ts — whose
-- tweet_id never appeared in pipeline_runs. Without a tweets row, the
-- dashboard renders those cards with no tweet text or media even when
-- the note has a perfectly valid pipeline_run ID and logs would be there.
-- This INSERT creates a minimal row (just tweet_id + first_seen_at +
-- last_updated_at) so the join succeeds; the writers (processTweet and
-- updateNoteFeedback's API overlay) populate the rich fields when they
-- learn them later.

-- DISTINCT ON because two notes can target the same tweet_id (we keep the
-- earliest `first_seen_at` of those notes for the tweet's first_seen_at).
INSERT INTO tweets (tweet_id, first_seen_at, last_updated_at)
SELECT DISTINCT ON (n.tweet_id)
  n.tweet_id,
  COALESCE(n.submitted_at, n.first_seen_at, NOW()),
  NOW()
FROM notes n
WHERE n.tweet_id IS NOT NULL
ORDER BY n.tweet_id, COALESCE(n.submitted_at, n.first_seen_at)
ON CONFLICT (tweet_id) DO NOTHING;

-- FK: pipeline_runs.note_id was plain TEXT before. Promote it to a real
-- referential integrity constraint now that the merged notes table is the
-- single source of truth for note_id. ON DELETE SET NULL because losing a
-- note row shouldn't cascade-delete the pipeline_run that produced it
-- (the pipeline run is interesting on its own — outcome, scores, logs).
ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_note_id_fkey
  FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE SET NULL;
