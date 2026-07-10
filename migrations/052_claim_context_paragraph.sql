-- Common Notes: store the paragraph the claim's quote came from, so the site
-- can show real surrounding context instead of a bare excerpt. Backfilled by
-- src/everything/backfillContextParagraph.ts (re-fetches transcripts/articles);
-- nullable — the frontend falls back to context_quote when absent.

alter table everything_claims add column context_paragraph text;
