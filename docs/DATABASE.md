# Database Reference

Supabase (Postgres). Tables ordered roughly by importance / how often you
need to look at them.

## Which table?

| Use case | Table |
|----------|-------|
| Note performance (views, status, ratings) | `notes` |
| Per-tweet engagement, media, author info | `tweets` |
| Pipeline debugging (why did a run fail?) | `pipeline_runs` (+ `pipeline_scores`) |
| Competitor analysis | `competing_notes` joined to `notes` |
| Public-data longitudinal tracking | `public_data_snapshots` |
| Scraper raw time-series | `scraped_notewriter_snapshots` |

## Data flow

```
BOT PIPELINE (every 15 min)
  generateCandidates.ts → processTweet.ts
  ├→ tweets (upsert per tweet — text, media, latest engagement)
  ├→ pipeline_runs (one row per processing attempt)
  └→ pipeline_scores (per-score detail rows — evaluation, source_verification, etc.)

  submitCandidates.ts → submitNoteForTweet.ts
  ├→ X API (/2/notes)
  ├→ pipeline_runs (in_progress → submitted)
  └→ notes (upsert by note_id with submission metadata)

SCRAPER (manual / periodic)
  scrapeNotewriterClickThrough.ts
  ├→ scraped_notewriter_snapshots (one row per scrape per note)
  └→ reconcileSnapshots.ts → notes (best-of-snapshots; data_tier; view_count)

PUBLIC DATA INGEST (daily)
  updateNoteFeedback.ts
  ├→ notes (cn_status, ratings, note_text)
  ├→ competing_notes (other notes on the same tweets as ours)
  └→ public_data_snapshots (longitudinal MF intercepts)

PIPELINE STATE
  feedSizeStrategy.ts / submitNoteForTweet.ts
  └→ pipeline_state (key/value: feed_size, writing_limit, limit_hit_at, ...)
```

---

## Tables

### 1. `notes` — master note table
One row per note we've ever observed (submitted by us or scraped pre-tracking).
Submission is indicated by `submitted_at IS NOT NULL`. For run/bot/score data,
join `notes.note_id` → `pipeline_runs.note_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `note_id` | TEXT UNIQUE | the X Community Note ID |
| `tweet_id` | TEXT NOT NULL | refers to `tweets.tweet_id` (no DB-level FK) |
| `note_text` | TEXT | full note content |
| `source_url` | TEXT | citation URL extracted from note text |
| `notewriter_id` | TEXT | which notewriter account submitted (NULL for pre-tracking) |
| `submitted_at` | TIMESTAMPTZ | when submitted to X via API (NULL for pre-tracking) |
| `cn_status` | TEXT | current X status — use this, not the dropped `current_core_status` |
| `view_count` | INTEGER | from scraper (only source) |
| `rating_count` | INTEGER DEFAULT 0 | aggregate (from public data dumps) |
| `helpful_count` | INTEGER DEFAULT 0 | aggregate |
| `somewhat_helpful_count` | INTEGER DEFAULT 0 | aggregate |
| `not_helpful_count` | INTEGER DEFAULT 0 | aggregate |
| `data_tier` | TEXT | `platinum` / `gold` / `silver` / `junk` / `impossible` (scraper quality) |
| `last_reconciled_at` | TIMESTAMPTZ | scraper reconciliation timestamp |
| `first_seen_at` | TIMESTAMPTZ NOT NULL | first scraper sighting / row creation |

Constraint: `data_tier CHECK (...)`. Referenced by
`competing_notes.our_note_id` and `scraped_notewriter_snapshots.note_id`.

---

### 2. `tweets` — tweet registry
One row per X tweet we've processed. Mirrors the `Post` shape from
[fetchEligiblePosts.ts](../src/api/fetchEligiblePosts.ts). Engagement
metrics are LATEST values, refreshed every pipeline run touching the tweet
(no per-run history — use `pipeline_runs.created_at` for that).

| Column | Type | Source |
|---|---|---|
| `tweet_id` | TEXT PK | `Post.id` |
| `author_id` | TEXT | `Post.author_id` |
| `author_handle` | TEXT | from scraper (when available) |
| `author_name` | TEXT | `Post.author_name` |
| `author_description` | TEXT | `Post.author_description` |
| `author_followers` | BIGINT | `Post.author_followers` |
| `author_tweet_count` | BIGINT | `Post.author_tweet_count` |
| `text` | TEXT | `Post.text` |
| `posted_at` | TIMESTAMPTZ | `Post.created_at` (the tweet's own X timestamp) |
| `impressions` | BIGINT | `Post.public_metrics.impression_count` |
| `likes`, `retweets`, `replies`, `quotes`, `bookmarks` | INTEGER | corresponding `public_metrics.*` |
| `media` | JSONB | raw X-API media array `[{type, url, ...}]` |
| `referenced_tweets` | JSONB | nullable, `[{type, id}]` |
| `referenced_tweet_data` | JSONB | nullable, `{id, author_id, created_at, text, media[]}` |
| `has_video`, `has_photo` | BOOLEAN | derived from `media` for fast filtering |
| `media_count` | INTEGER | derived |
| `video_duration_ms` | INTEGER | derived |
| `first_seen_at` | TIMESTAMPTZ | when we first processed this tweet |
| `last_updated_at` | TIMESTAMPTZ | most recent metric refresh |

Index: PK on `tweet_id`, `author_id`.

---

### 3. `pipeline_runs` — every processing attempt
One row per tweet-bot processing attempt (a tweet can have multiple if it
gets retried).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tweet_id` | TEXT | refers to `tweets.tweet_id` (no DB-level FK) |
| `bot_name` | TEXT | short family, e.g. `claude-simple` |
| `bot_name_long` | TEXT | variant-suffixed, e.g. `claude-simple_claude-simple-sonnet-gemini` |
| `bot_config` | JSONB | full BotConfig snapshot for the run (NULL for historical rows) |
| `outcome` | TEXT | `submitted` / `candidate` / `rejected` / `failed` / `filtered` / `in_progress` |
| `outcome_reason` | TEXT | semantic category — `no_correction_needed`, `check_failed`, `low_evaluation_score`, `bot_error`, `daily_limit_reached`, `tweet_deleted`, `ineligible`, etc. |
| `final_stage` | TEXT | last stage reached: `started` / `scoring` / `source_trust` / `note_writing` / `check` / `evaluation` / `candidate` / `submission` / `filtering` |
| `error_message` | TEXT | populated when `outcome = failed` |
| `note_id` | TEXT | refers to `notes.note_id` (when submitted) |
| `note_text` | TEXT | bot's generated note (kept even for non-submitted runs — useful for review) |
| `evaluation_score` | DOUBLE PRECISION | the bot's self-eval score |
| `commit_sha` | TEXT | git SHA of the deployed bot at run time |
| `created_at` | TIMESTAMPTZ NOT NULL | the run's primary timestamp |
| `logs` | JSONB | full structured debug dump; cost breakdown lives at `logs->'costs'` (`entries`, `groups`, `total`) |
| `cost` | NUMERIC(10, 6) | total LLM cost in USD (incl. tools); NULL for runs without captured cost data |

Indexes: `tweet_id`, `outcome`, `final_stage`, `(outcome, created_at DESC) WHERE outcome='candidate'`, `bot_name`, `bot_name_long`.

---

### 4. `pipeline_scores` — per-score detail rows
Flexible store for the ~13 score types attached to a pipeline run (the
fast-path numeric `evaluation_score` lives directly on `pipeline_runs`).

| Column | Type |
|---|---|
| `id` | UUID PK |
| `pipeline_run_id` | UUID FK → `pipeline_runs.id` ON DELETE CASCADE |
| `score_type` | TEXT (`source_verification`, `helpfulness`, `positive_claims`, `disagreement`, ...) |
| `score_value` | NUMERIC (nullable for non-numeric types) |
| `score_label` | TEXT (e.g. `YES`/`NO` for source verification) |
| `score_metadata` | JSONB (typically `{reasoning: "..."}`) |
| `created_at` | TIMESTAMPTZ NOT NULL |

Indexes: `pipeline_run_id`, `score_type`.

---

### 5. `competing_notes` — other notes on our tweets
Both direct competitors (other notes on tweets we also wrote a note for)
and "missed opportunities" (helpful notes on tweets where we ran the
pipeline but didn't submit). For missed opportunities, `our_note_id` is
NULL and `pipeline_run_id` is set.

| Column | Type |
|---|---|
| `id` | UUID PK |
| `tweet_id` | TEXT |
| `note_id` | TEXT |
| `our_note_id` | TEXT FK → `notes.note_id` (nullable) |
| `pipeline_run_id` | UUID FK → `pipeline_runs.id` (set for missed opportunities) |
| `author_participant_id` | TEXT |
| `note_text` | TEXT |
| `classification` | TEXT |
| `current_status` | TEXT |
| `created_at_millis` | BIGINT (the competing note's CN creation time) |
| `first_seen_date` | TEXT |
| `last_updated_at` | TIMESTAMPTZ |

Unique: `(note_id, our_note_id)`, plus `(note_id, pipeline_run_id) UNIQUE WHERE our_note_id IS NULL`.

---

### 6. `scraped_notewriter_snapshots` — scraper time-series
One row per scrape per note. This is the one place we intentionally keep
every observation — `reconcileSnapshots.ts` reads them to derive the
canonical `notes` row.

| Column | Type |
|---|---|
| `id` | UUID PK |
| `note_id` | TEXT FK → `notes.note_id` |
| `cn_status` | TEXT (at scrape time) |
| `view_count` | INTEGER |
| `shown_on_x` | BOOLEAN |
| `rater_tags` | TEXT[] |
| `tweet_id` | TEXT (denormalized for collision detection) |
| `note_text` | TEXT (for anomaly detection) |
| `tweet_handle`, `tweet_text`, `tweet_time` | TEXT |
| `scraped_at` | TIMESTAMPTZ |

Indexes: `note_id`, `scraped_at DESC`.

---

### 7. `public_data_snapshots` — daily MF intercepts
Longitudinal store of bridging-MF scores and historical statuses for our
notes plus helpful competitors. One row per `(note_id, snapshot_date)`.

| Column | Type |
|---|---|
| `id` | UUID PK |
| `note_id` | TEXT |
| `tweet_id` | TEXT |
| `current_status` | TEXT |
| `is_ours` | BOOLEAN |
| `snapshot_date` | DATE |
| `created_at_millis` | BIGINT |
| `core_note_intercept` | NUMERIC (>0.4 = helpful, <-0.04 = not helpful) |
| `core_note_factor1` | NUMERIC |

Unique: `(note_id, snapshot_date)`.

---

### 8. `notewriters` — bot accounts
| Column | Type |
|---|---|
| `id` | UUID PK |
| `handle` | TEXT UNIQUE |
| `display_name` | TEXT |
| `credentials_ref` | TEXT |
| `is_active` | BOOLEAN DEFAULT true |
| `created_at` | TIMESTAMPTZ |

---

### 9. `pipeline_state` — k/v state across runs
Used by feedSizeStrategy and the rate-limit detection in `submitNoteForTweet`.

| Column | Type |
|---|---|
| `key` | TEXT PK |
| `value` | TEXT |
| `updated_at` | TIMESTAMPTZ |

Common keys: `feed_size`, `writing_limit`, `limit_hit_at`,
`days_without_limit_hit`, `days_with_limit_hit`, `limit_hit_today`,
`last_limit_check_date`.

---

### 10–13. Review dashboard tables
`review_dashboard_uploads`, `review_dashboard_items`,
`review_dashboard_failure_modes`, `review_dashboard_annotations`. See the
review dashboard code for usage; they're only touched by
`src/review-dashboard/` and the dataset-run upload path.

---

## CN status values

`cn_status` (and `competing_notes.current_status`) come from X's public
data dumps. Possible values:

- `CURRENTLY_RATED_HELPFUL` — note is showing on the tweet
- `CURRENTLY_RATED_NOT_HELPFUL`
- `NEEDS_MORE_RATINGS` — default; not enough raters yet
- `(null)` — public data hasn't ingested this note yet

**Always read `cn_status` (overall), not `current_core_status`** — see
the CLAUDE.md gotcha. The core submodel misses notes rated helpful by the
expansion or group submodels.

## Migration order if running from scratch

`migrations/` numbered 001 → 034. Apply in order via `psql -f`. Migration
032 must be followed by `scripts_jim/2026_05_01_backfill_tweets_from_logs/main.ts`
BEFORE 033 lands, otherwise log-derived media data is unreachable.
