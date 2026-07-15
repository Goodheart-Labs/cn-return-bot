-- Common Notes: sources heal. When the live source text changes after a claim
-- was captured (three ai-2040 pages were corrected in line with our notes,
-- 2026-07-14), we never rewrite the captured quote — the note responded to
-- THAT text. Instead the current wording is stored here and the card renders
-- "original quote → source now reads: …", with the deep-link targeting the
-- current text. Nullable; absent means the source still matches the capture.

alter table everything_claims add column updated_quote text;
