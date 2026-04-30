-- Drop bot_configs table.
--
-- The table only stored a name registry and a never-populated `config` JSONB.
-- Production never read it back; `notes.bot_name` already carries the same
-- string. The FK column `notes.bot_config_id` is also dropped — nothing reads
-- it (verified across src/, excluding scripts journals).

-- The dashboard view `notes_with_snapshot` (created in 008, unused — see stage 1B)
-- references `notes.bot_config_id`, so it has to go before we can drop the column.
DROP VIEW IF EXISTS notes_with_snapshot;
DROP VIEW IF EXISTS latest_scraped_snapshots;

ALTER TABLE notes DROP COLUMN IF EXISTS bot_config_id;
DROP TABLE IF EXISTS bot_configs;
