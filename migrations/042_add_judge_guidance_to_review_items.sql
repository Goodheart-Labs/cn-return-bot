-- Surface big_eval's annotation context in the review dashboard.
-- judge_guidance / original_note_text / failure_reason come from
-- datasets/big_eval/splits/*.csv and let reviewers see the strict-criteria
-- annotation alongside the bot's output.

ALTER TABLE review_dashboard_items
  ADD COLUMN IF NOT EXISTS judge_guidance TEXT,
  ADD COLUMN IF NOT EXISTS original_note_text TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;
