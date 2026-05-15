-- Mark failure modes as "fixed" so they're hidden from the review dashboard
-- by default. Useful for tracking which categorized problems we've addressed.

ALTER TABLE review_dashboard_failure_modes
  ADD COLUMN IF NOT EXISTS fixed BOOLEAN NOT NULL DEFAULT FALSE;
