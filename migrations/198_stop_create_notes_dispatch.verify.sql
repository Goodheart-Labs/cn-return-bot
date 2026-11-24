-- Checks for migration 198. Run it after the migration. It changes nothing.
-- Every value should be true.
select not exists (select 1 from cron.job where jobname = 'dispatch-create-notes') as create_notes_no_longer_dispatched;
