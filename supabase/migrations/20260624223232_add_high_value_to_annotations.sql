ALTER TABLE review_dashboard_annotations
  ADD COLUMN IF NOT EXISTS high_value boolean NOT NULL DEFAULT false;
