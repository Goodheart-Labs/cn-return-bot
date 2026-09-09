-- The visit counter migration 083 introduced, dropped now that nothing calls it
-- (GOO-135).
--
-- Migration 089 left it alone on purpose. It returned visits per creator, and
-- the pipeline called it on every walk, so dropping it in the same file would
-- have broken every walk between applying that migration and deploying the code
-- that calls everything_creator_attention instead.
--
-- Apply this AFTER the GOO-135 pull request is merged and its workflow run has
-- picked up the new code.

drop function if exists everything_visit_counts(timestamptz);
