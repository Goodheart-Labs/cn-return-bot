-- Checks for migration 185, run after it on migration 184's fixture. While
-- the pipeline takes no feed posts, a due alarm dispatches nothing, and the
-- schedule is left as it was. Prints true.
begin;
update everything_notewriters set every_minutes = null where id = 'pipeline';
update everything_feed_schedule set next_run_at = now() - interval '1 hour';
select not everything_dispatch_feed_run_if_due()
       and (select next_run_at = now() - interval '1 hour' from everything_feed_schedule) as unsubscribed_pipeline_dispatches_nothing;
rollback;
