-- An errored item used to be dead forever. The feed walker treats any existing
-- whole-page item as processed, so a transient failure such as a flagged proxy
-- IP or an exhausted API key permanently killed the item. By August 2026 that
-- had silently killed 71 of 346 items. Now the auto-enqueue triage puts an
-- errored item back in the queue a bounded number of times. This column counts
-- those repeat attempts.
alter table everything_items add column retries smallint not null default 0;
