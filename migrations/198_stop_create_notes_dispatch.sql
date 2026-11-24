-- Stop dispatching the Create Notes Routine workflow (GOO-865). The X note
-- writer of the first account now runs on the services box, after every walk
-- of the feed by cn-feed-views (src/x-notes/writer.ts), instead of in a GitHub
-- Actions run every 30 minutes. The workflow stays and can still be started
-- by hand. Both would check different tweets, because a picked tweet goes into
-- the tweets table at once, and submissions go through the claims of
-- migration 100, so a manual run does no harm.
--
-- To undo, run the cron.schedule call of migration 047 again.
select cron.unschedule('dispatch-create-notes');
