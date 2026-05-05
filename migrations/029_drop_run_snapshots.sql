-- Drop run_snapshots and the entire backlog-tracking concept.
--
-- The table held one row per cron run with backlog metrics. The pipeline writer
-- and report renderer are removed in the same commit; nothing else reads it.

DROP TABLE IF EXISTS run_snapshots;
