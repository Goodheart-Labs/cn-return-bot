-- ---------------------------------------------------------------------------
-- Image-based claims. A Substack article's inline images are now fed to the
-- extractor, so a claim can be grounded in text, an image, or both. Each claim
-- records the image URLs it relies on (shown above its context in the SPA), and
-- context_quote becomes nullable so an image-only claim need carry no verbatim
-- text excerpt.
-- ---------------------------------------------------------------------------

alter table everything_claims add column image_urls jsonb not null default '[]';
alter table everything_claims alter column context_quote drop not null;
