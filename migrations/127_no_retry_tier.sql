-- 127: failed feed posts leave the queue and go back to the walk (GOO-487).
--
-- From 2026-10-14 the retry sweep put every failed feed post back in the
-- queue at priority -1, a tier below every new post. The code no longer has
-- that tier. A failed post now stays in error, and the walk picks it again in
-- its creator's rank order once its rest time is over.
--
-- When this was written, 687 posts waited in the queue at that tier. 685 of
-- them failed only because the OpenRouter credits ran out from 2026-10-17 to
-- 2026-10-19, and the outage used up attempts they never really had. So each
-- of them goes back to error with all its attempts restored. Their last
-- failure is more than three hours old, so the walk can take them at once.
--
-- Every other row at that tier is done or out of attempts. Its priority only
-- matters if a person requeues it by hand, so it moves to the visits tier (0).

update everything_items
set status = 'error', retries = 0, priority = 0
where status = 'queued' and priority = -1;

update everything_items
set priority = 0
where priority = -1;
