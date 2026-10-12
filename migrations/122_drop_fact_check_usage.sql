-- The daily call counter of the fact-check edge function, dropped now that the
-- function is deleted (GOO-320).
--
-- The function was deployed by hand on 2026-07-24 for an "Is this true?"
-- feature that never shipped. The table and the function below were created
-- at the same time without a migration, so they exist only in production.
-- The function was deleted from production on 2026-10-12, so nothing calls
-- either of them any more.

drop function if exists fact_check_consume(text, integer);
drop table if exists fact_check_usage;
