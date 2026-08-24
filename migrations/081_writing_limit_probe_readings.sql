-- Writing-limit probe readings.
--
-- The probe (src/scripts/writingLimitProbe.ts) has printed the formula's
-- inputs and its predicted cap into GitHub Action logs since 2026-08-12.
-- Those logs expire after ~90 days, so the series it was built to produce
-- has been evaporating behind it.
--
-- The point of keeping it is the PAIR, not the prediction. X's real cap has
-- run about 2.4x the formula's arithmetic -- on 2026-08-17..20 we posted
-- 87/110/80/91 against predicted caps of 37/38/41/42 with no refusal, and the
-- last actual 403 was 2026-08-14 at 90. Until predicted and observed sit in
-- the same row on the same day, that ratio stays a guess we re-derive by hand
-- (badly) every time it matters. One row per probe run makes it fittable.
--
-- Service-key only. Nothing reads this in the pipeline; it is an analysis
-- series, and the probe must never be able to affect posting behaviour.

create table if not exists writing_limit_probe_readings (
  id              bigserial primary key,
  measured_at     timestamptz not null default now(),

  -- Formula inputs, exactly as the probe computes them.
  nh_5            integer not null,
  nh_10           integer not null,
  hr_r            double precision not null,   -- last 20 notes
  hr_100          double precision not null,   -- last 100 notes
  hr_14d          double precision not null,   -- last 14 days
  hr_l            double precision not null,   -- max(hr_100, hr_14d), the operative rate
  dn_30           double precision not null,   -- avg notes/day over 30 days

  -- Formula outputs.
  wl_l            double precision,            -- quality term; null on a cliff/new-writer branch
  volume_term     double precision not null,   -- dn_30 * 5
  predicted_limit integer not null,
  branch          text not null,               -- which formula branch fired
  binding         text not null,               -- 'QUALITY' | 'VOLUME'

  -- Account state at probe time.
  notes_total     integer not null,
  status_counts   jsonb not null,

  -- The observed side. Without these the row cannot be fitted against reality.
  submitted_24h       integer,      -- notes we actually got away with in the trailing 24h
  stored_limit        integer,      -- pipeline_state.writing_limit (a ratchet guess, not an observation)
  last_403_at         timestamptz,  -- pipeline_state.limit_hit_at
  last_403_value      integer,      -- pipeline_state.limit_hit_value -- the ONLY hard observation of the cap
  hours_since_last_403 double precision
);

comment on table writing_limit_probe_readings is
  'One row per writing-limit probe run. Pairs the formula''s predicted cap with what X actually allowed, so the ~2.4x gap between them can be fitted instead of re-guessed.';

comment on column writing_limit_probe_readings.last_403_value is
  'Trailing-24h submission count at the moment X refused. This is the only hard observation of the real cap; predicted_limit is theory, stored_limit is a ratchet guess.';

create index if not exists writing_limit_probe_readings_measured_at_idx
  on writing_limit_probe_readings (measured_at desc);

alter table writing_limit_probe_readings enable row level security;
-- No policies: service key only. Deliberate -- the anon key is baked into the
-- public site and this is internal cap telemetry.
