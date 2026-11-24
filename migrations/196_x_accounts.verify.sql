-- Checks for migration 196. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  (select count(*) = 0 from pipeline_runs where x_account <> 'stilt' and created_at < '2026-11-23') as old_runs_are_stilt,
  (select count(*) = 0 from notes where x_account <> 'stilt' and submitted_at < '2026-11-23') as old_notes_are_stilt,
  (select bool_and(convalidated) from pg_constraint where conname in ('pipeline_runs_x_account_check', 'notes_x_account_check')) as checks_validated,
  (select count(*) = 2 from pg_constraint where conname in ('pipeline_runs_x_account_check', 'notes_x_account_check')) as both_checks_exist,
  exists (select 1 from pg_indexes where indexname = 'pipeline_runs_other_accounts_idx') as other_accounts_index_exists,
  pg_get_functiondef('public.get_note_submission_capacity'::regproc) like '%x_account = ''stilt''%' as capacity_counts_stilt_only,
  pg_get_functiondef('public.claim_note_submission'::regproc) like '%x_account = ''stilt''%' as claim_checks_stilt_only,
  pg_get_functiondef('public.queue_signal_submission'::regproc) like '%x_account = ''stilt''%' as signal_queue_checks_stilt_only;
