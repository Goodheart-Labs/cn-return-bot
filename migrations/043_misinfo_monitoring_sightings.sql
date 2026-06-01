-- XXL-feed misinfo-monitoring pre-pass: dedicated sightings table.
--
-- DELIBERATELY DISJOINT from the regular skip logic. getSkipTweetIds() builds
-- its skip set only from `notes` + rejected `pipeline_runs`; getKnownTweetIds()
-- reads only `tweets`. This table is touched by neither, so merely *sighting* a
-- post in the XXL feed can never cause the regular pipeline to skip it later
-- when it enters the small feed. A sighting we actually *process* and reject
-- enters the normal rejection cooldown via pipeline_runs — identical to the
-- small feed rejecting it.
--
-- One row per (tweet, topic): the same tweet can match multiple topics.
--
-- `id` is a surrogate identity PK used purely as the keyset-pagination cursor
-- (getMisinfoSightingKeys reads the whole table, which grows unboundedly over
-- time, so it must paginate on a unique monotonic single column — the natural
-- (tweet_id, topic_id) key is composite). Uniqueness of the natural key is kept
-- as a constraint so upserts can target it via onConflict.

create table misinfo_monitoring_sightings (
  id               bigint generated always as identity primary key,
  tweet_id         text not null,
  topic_id         text not null,
  feed_size        text not null,
  impression_count bigint,
  author_name      text,
  first_seen_at    timestamptz not null default now(),
  needs_note       boolean,             -- null = not yet evaluated by the selection LLM
  selection_reason text,
  evaluated_at     timestamptz,
  processed_run_id uuid references pipeline_runs(id),
  processed_at     timestamptz,
  unique (tweet_id, topic_id)
);

-- Partial index for the per-topic "find not-yet-evaluated sightings" scan.
create index misinfo_monitoring_sightings_unevaluated_idx
  on misinfo_monitoring_sightings (topic_id)
  where needs_note is null;

-- Partial index for the "collect posts that need a note but aren't processed yet" scan.
create index misinfo_monitoring_sightings_pending_idx
  on misinfo_monitoring_sightings (topic_id)
  where needs_note is true and processed_run_id is null;
