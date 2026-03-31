# Database Reference

Supabase (Postgres). All tables use `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` and `created_at TIMESTAMPTZ DEFAULT NOW()` unless noted.

## Which table?

| Use case | Table |
|----------|-------|
| Note performance (views, status, ratings) | `canonical_note_information` |
| Submission metadata (bot, timestamp, eval score) | `notes` |
| Pipeline debugging (why was a tweet rejected?) | `pipeline_runs` + `pipeline_scores` |
| Competitor analysis | `competing_notes` joined to `canonical_note_information` |
| Public data time-series | `public_data_snapshots` |
| Scraper raw time-series | `scraped_notewriter_snapshots` |

## Data flow

```
BOT PIPELINE (every 15 min)
  generateCandidates.ts → processTweet.ts
  ├→ pipeline_runs (outcome=in_progress, then completed)
  ├→ pipeline_scores (evaluation, source_verification, etc.)
  └→ run_snapshots (backlog metrics)

  submitCandidates.ts
  ├→ pipeline_runs (candidate → submitted)
  └→ notes (new row on successful X submission)

SCRAPER (manual/periodic)
  scrapeNotewriterClickThrough.ts
  ├→ canonical_note_information (upsert core note data)
  └→ scraped_notewriter_snapshots (point-in-time metrics)

PUBLIC DATA IMPORT (daily)
  updateNoteFeedback.ts
  ├→ canonical_note_information (status, ratings, classification)
  ├→ notes (cn_status, helpful counts)
  ├→ public_data_snapshots (historical record)
  └→ competing_notes (other notes on same tweets)

FEED SIZE STRATEGY
  feedSizeStrategy.ts
  └→ pipeline_state (key-value state for rate limit tracking)
```

---

## Tables

### notewriters

Notewriter X accounts. Currently only `wholesome-raspberry-stilt` is active.

| Column | Type | Description |
|--------|------|-------------|
| handle | TEXT UNIQUE | X username |
| display_name | TEXT | Display name |
| credentials_ref | TEXT | Reference to stored OAuth credentials |
| is_active | BOOLEAN | Whether account is in use |

### bot_configs

Bot configuration registry. Looked up by name via `getOrCreateBotConfig()`.

| Column | Type | Description |
|--------|------|-------------|
| name | TEXT UNIQUE | Bot identifier (e.g. `opus-main`, `kimi-k2`) |
| description | TEXT | Human-readable description |
| config | JSONB | Bot-specific settings |
| is_active | BOOLEAN | Whether bot is actively used |

### pipeline_runs

Every tweet processed through the pipeline. One row per processing attempt. A tweet can have multiple rows (retries, different bots).

| Column | Type | Description |
|--------|------|-------------|
| tweet_id | TEXT | Tweet being processed |
| author_id | TEXT | Tweet author's X ID |
| tweet_text | TEXT | Tweet text (truncated to 500 chars) |
| has_video | BOOLEAN | Tweet contains video |
| has_photo | BOOLEAN | Tweet contains photo |
| media_count | INTEGER | Number of media attachments |
| video_duration_ms | INTEGER | Video duration if applicable |
| bot_id | TEXT | Which bot processed this tweet |
| outcome | TEXT | Final result — see [outcome enum](#pipeline_runsoutcome) |
| outcome_reason | TEXT | Why this outcome — see [outcome_reason enum](#pipeline_runsoutcome_reason) |
| error_message | TEXT | Error details when outcome=failed, or warnings |
| final_stage | TEXT | Last pipeline stage reached — see [final_stage enum](#pipeline_runsfinal_stage) |
| note_id | TEXT | Links to `notes.note_id` if outcome=submitted |
| note_text | TEXT | Generated note text + URL (stored for candidates) |
| source_url | TEXT | URL cited in the note |
| note_status | TEXT | LLM output status — see [note_status enum](#pipeline_runsnote_status) |
| search_results | TEXT | Search context used by bot (truncated to 10k chars) |
| check_reasoning | TEXT | Source verification raw result |
| logs | JSONB | Full nested TweetLogMap for the run |
| tweet_impressions | BIGINT | Tweet impressions at processing time |
| tweet_likes | INTEGER | Tweet likes at processing time |
| tweet_retweets | INTEGER | Tweet retweets at processing time |
| tweet_replies | INTEGER | Tweet replies at processing time |
| tweet_quotes | INTEGER | Tweet quotes at processing time |
| tweet_bookmarks | INTEGER | Tweet bookmarks at processing time |
| author_followers | BIGINT | Author's follower count at processing time |
| commit_sha | TEXT | Git commit that produced this run |

**Lifecycle**: `createPipelineRun()` inserts with outcome=`in_progress`, final_stage=`started`. `completePipelineRun()` updates with final outcome. `markCandidateSubmitted()` flips candidate→submitted. `markCandidateExpired()` flips candidate→rejected.

**Skip logic** (`getProcessedTweetIds()`): Tweets are skipped if they have a submitted note, 3+ no_correction_needed rejections, are on cooldown (1hr after 1 rejection, 24hr after 2), or have an above-floor candidate waiting.

### pipeline_scores

Scores attached to pipeline runs. One row per score per run. FK `pipeline_run_id → pipeline_runs(id) ON DELETE CASCADE`.

| Column | Type | Description |
|--------|------|-------------|
| pipeline_run_id | UUID FK | Parent pipeline run |
| score_type | TEXT | Score category — see [score_type enum](#pipeline_scoresscore_type) |
| score_value | NUMERIC | Numeric score (nullable for non-numeric) |
| score_label | TEXT | Text label (e.g. `YES`/`NO` for source_verification) |
| score_metadata | JSONB | Extra info, typically `{ reasoning: "..." }` |

### notes

Submitted community notes. One row per successful X submission. Incomplete history (~732 notes since Jan 7 2026). For comprehensive analysis, prefer `canonical_note_information`.

| Column | Type | Description |
|--------|------|-------------|
| note_id | TEXT | X's Community Note ID (returned from submission API) |
| tweet_id | TEXT | Tweet this note addresses |
| notewriter_id | TEXT | Notewriter handle (TEXT, not FK to notewriters) |
| bot_config_id | TEXT | Bot config name (TEXT, not FK to bot_configs) |
| bot_name | TEXT | Bot identifier |
| note_text | TEXT | Full note text |
| source_url | TEXT | URL cited in note |
| evaluation_score | DOUBLE PRECISION | Evaluation score at submission time |
| commit_sha | TEXT | Git commit at submission time |
| submitted_at | TIMESTAMPTZ | When note was submitted to X |
| cn_status | TEXT | Current X status, updated by `updateNoteFeedback()` from public data |
| helpful_count | INTEGER | Helpful ratings from X |
| somewhat_helpful_count | INTEGER | Somewhat helpful ratings |
| not_helpful_count | INTEGER | Not helpful ratings |
| first_helpful_at | TIMESTAMPTZ | When note first reached CURRENTLY_RATED_HELPFUL |
| view_count | INTEGER | View count (updated by `updateViewCount()`) |
| views_last_updated_at | TIMESTAMPTZ | When view_count was last fetched |
| last_checked_at | TIMESTAMPTZ | When feedback was last updated; used by `getNotesNeedingFeedback()` staleness filter |

### canonical_note_information

Reconciled master record of ALL bot-written notes (~1,693 notes back to Aug 2025). Default table for performance analysis. Renamed from `scraped_notewriter_notes` in migration 017.

| Column | Type | Description |
|--------|------|-------------|
| note_id | TEXT UNIQUE | X Community Note ID. May initially be `tweet_XXXX` placeholder until resolved |
| tweet_id | TEXT | Tweet this note addresses |
| note_text | TEXT | Note content |
| source_url | TEXT | URL cited in note |
| first_seen_at | TIMESTAMPTZ | When scraper first found this note |
| cn_status | TEXT | Latest X status (from public data or scraper) |
| view_count | INTEGER | Latest view count |
| data_tier | TEXT | Quality classification: `platinum`, `gold`, `silver`, `junk`, `impossible` |
| last_reconciled_at | TIMESTAMPTZ | When tier/reconciliation last ran |
| coherence_score | REAL | Coherence metric |
| rater_tags | TEXT[] | Tags from CN raters |
| tweet_handle | TEXT | Tweet author's handle |
| tweet_text | TEXT | Tweet content |
| tweet_time | TEXT | Tweet timestamp (stored as text) |
| current_core_status | TEXT | Status from core rater network (from public data noteStatusHistory) |
| current_expansion_status | TEXT | Status from expansion rater network |
| current_group_status | TEXT | Status from group voting |
| current_decided_by | TEXT | Which rater group determined status: `CORE`, `EXPANSION`, `GROUP` |
| current_modeling_group | TEXT | CN's modeling group assignment |
| first_non_nmr_status | TEXT | First status after leaving NEEDS_MORE_RATINGS |
| most_recent_non_nmr_status | TEXT | Most recent non-NMR status |
| locked_status | TEXT | Final locked status (if locked) |
| status_updated_at | TIMESTAMPTZ | When status fields were last updated from public data |
| first_non_nmr_at | TIMESTAMPTZ | When note first left NMR |
| status_locked_at | TIMESTAMPTZ | When status was locked |
| classification | TEXT | X's note classification (from public data notes file) |
| public_data_updated_at | TIMESTAMPTZ | When public data last updated this row |
| rating_count | INTEGER | Total ratings |
| helpful_count | INTEGER | Helpful ratings |
| not_helpful_count | INTEGER | Not helpful ratings |
| top_helpful_tag | TEXT | Most common helpful tag |
| top_not_helpful_tag | TEXT | Most common not-helpful tag |
| ratings_updated_at | TIMESTAMPTZ | When rating fields were last updated |

**Filtering**: `getNotesWithLatestSnapshots()` excludes rows where `data_tier = 'junk'`.

### scraped_notewriter_snapshots

Point-in-time metrics from scraping the notewriter page. One row per note per scrape. FK `note_id → canonical_note_information(note_id)`.

| Column | Type | Description |
|--------|------|-------------|
| note_id | TEXT FK | Which note |
| cn_status | TEXT | Status at scrape time |
| view_count | INTEGER | Views at scrape time |
| helpful_count | INTEGER | Helpful ratings at scrape time |
| somewhat_helpful_count | INTEGER | Somewhat helpful ratings |
| not_helpful_count | INTEGER | Not helpful ratings |
| shown_on_x | BOOLEAN | Whether note was displayed on X |
| rater_tags | TEXT[] | Rater tags at scrape time |
| tweet_id | TEXT | Tweet ID (denormalized for convenience) |
| note_text | TEXT | Note text (for anomaly detection — should be immutable) |
| tweet_handle | TEXT | Tweet author handle |
| tweet_text | TEXT | Tweet content |
| tweet_time | TEXT | Tweet timestamp |
| scraped_at | TIMESTAMPTZ | When this snapshot was captured |

### public_data_snapshots

Daily snapshots from X's public Community Notes data dumps. Tracks both our notes and all other notes. `UNIQUE(note_id, snapshot_date)`.

| Column | Type | Description |
|--------|------|-------------|
| note_id | TEXT | Community Note ID |
| tweet_id | TEXT | Tweet this note addresses |
| current_status | TEXT | Status from noteStatusHistory dump |
| is_ours | BOOLEAN | TRUE if note_id is in our `notes` table |
| snapshot_date | DATE | Date of the data dump |
| created_at_millis | BIGINT | When note was created (from CN data, epoch ms) |
| core_note_intercept | NUMERIC | Bridging-based score. >0.4 = helpful, <-0.04 = not helpful |
| core_note_factor1 | NUMERIC | Factor from matrix factorization model |

### competing_notes

Other notes on the same tweets as our notes. `UNIQUE(note_id, our_note_id)`. FK `our_note_id → canonical_note_information(note_id)`.

| Column | Type | Description |
|--------|------|-------------|
| tweet_id | TEXT | Shared tweet ID |
| note_id | TEXT | Competing note's ID |
| our_note_id | TEXT FK | Which of our notes is on this tweet |
| author_participant_id | TEXT | Author of competing note |
| note_text | TEXT | Competing note content |
| classification | TEXT | X's classification |
| current_status | TEXT | Competing note's status |
| current_core_status | TEXT | Core rater status |
| current_decided_by | TEXT | Which rater group decided |
| created_at_millis | BIGINT | When created (epoch ms) |
| rating_count | INTEGER | Total ratings |
| helpful_count | INTEGER | Helpful ratings |
| not_helpful_count | INTEGER | Not helpful ratings |
| first_seen_date | TEXT | Date first seen in data dump |
| last_updated_at | TIMESTAMPTZ | Last upsert time |

### run_snapshots

One row per cron run (~96/day with 15-min schedule). Lightweight pipeline health metrics.

| Column | Type | Description |
|--------|------|-------------|
| backlog_total | INTEGER | Eligible tweets from X API (up to 200) |
| backlog_new | INTEGER | Never-seen-before tweets |
| backlog_retry | INTEGER | Previously attempted, not resolved |
| backlog_hit_limit | BOOLEAN | Whether we hit the 200-tweet API cap |
| posts_processed | INTEGER | Tweets actually processed this run |
| commit_sha | TEXT | Git commit of this run |
| feed_size | TEXT | Feed size strategy used (`small`, `medium`, `large`) |

### pipeline_state

Key-value store for persistent state between runs.

| Column | Type | Description |
|--------|------|-------------|
| key | TEXT PK | State key |
| value | TEXT | State value |
| updated_at | TIMESTAMPTZ | Last update |

**Known keys**: `feed_size`, `bottlenecked`, `days_without_limit_hit`, `days_with_limit_hit`, `limit_hit_today`, `last_limit_check_date`

### unmatched_scraped_notes

Notes found by scraper that weren't in our `notes` table (pre-tracking era). `UNIQUE(note_id)`. Largely superseded by `canonical_note_information`.

| Column | Type | Description |
|--------|------|-------------|
| note_id | TEXT UNIQUE | Community Note ID |
| tweet_id | TEXT | Tweet ID |
| note_text | TEXT | Note content |
| cn_status | TEXT | X status |
| view_count | INTEGER | View count |
| views_last_updated_at | TIMESTAMPTZ | When views were last updated |
| source_url | TEXT | URL cited |
| discovered_at | TIMESTAMPTZ | When first scraped |
| last_checked_at | TIMESTAMPTZ | When last updated |

---

## Views

### latest_scraped_snapshots

Latest snapshot per note. `DISTINCT ON (note_id) ... ORDER BY note_id, scraped_at DESC`.

Columns: `note_id`, `snapshot_status`, `snapshot_views`, `snapshot_helpful`, `snapshot_not_helpful`, `snapshot_scraped_at`

### notes_with_snapshot

`notes LEFT JOIN latest_scraped_snapshots ON note_id`. Adds computed columns:
- `effective_status`: `COALESCE(notes.cn_status, snapshot_status)` — prefers public data
- `view_count`: from snapshot (only source in this view)
- `status_source`: `'public_data'` | `'snapshot'` | `'unknown'`

---

## Enum values

### pipeline_runs.outcome

| Value | Meaning |
|-------|---------|
| `in_progress` | Currently being processed (initial state) |
| `candidate` | Passed all checks, waiting for submission ranking |
| `submitted` | Successfully submitted to X |
| `rejected` | Didn't pass quality gates |
| `failed` | Error during processing |
| `filtered` | Tweet filtered before main pipeline (e.g. video) |

### pipeline_runs.outcome_reason

| Value | Meaning |
|-------|---------|
| `no_correction_needed` | LLM determined tweet doesn't need correction |
| `check_failed` | Source verification returned NO |
| `check_error` | Source verification errored |
| `low_evaluation_score` | Evaluation score below submission threshold |
| `scoring_filters_failed` | Bot scoring filters rejected the note |
| `source_trust_failed` | Source trust check failed |
| `bot_error` | Bot threw an error |
| `bot_returned_null` | Bot returned no result |
| `submission_error` | X API submission failed |
| `no_note_id_in_response` | X API didn't return a note ID |
| `video_cap` | Tweet has video (filtered) |
| `candidate_expired` | Candidate too old, never submitted |

### pipeline_runs.final_stage

| Value | Meaning |
|-------|---------|
| `started` | Bot returned nothing |
| `scoring` | Stopped at scoring filters |
| `source_trust` | Stopped at source trust check |
| `note_writing` | Stopped at note generation |
| `check` | Stopped at source verification |
| `evaluation` | Stopped at evaluation scoring |
| `candidate` | Passed all checks, became candidate |
| `submission` | Reached submission (submitted or expired) |
| `filtering` | Pre-pipeline filter |

### pipeline_runs.note_status

LLM output from note writing. The bot returns one of:
- `CORRECTION WITH TRUSTWORTHY CITATION` — note was written (only status that proceeds)
- `TWEET NOT SIGNIFICANTLY INCORRECT` — no correction needed
- `SCORING_FILTERS_FAILED` — bot scoring filters rejected
- `SOURCE_TRUST_FAILED` — source trust check rejected

### pipeline_scores.score_type

| Value | Source | Description |
|-------|--------|-------------|
| `evaluation` | `shouldSubmitNote()` | Overall submission decision score |
| `source_verification` | `checkResult` | Source check (label: YES/NO) |
| `positive_claims` | Bot scoring | Positive evidence score |
| `disagreement` | Bot scoring | Disagreement with tweet score |
| `helpfulness` | Bot scoring | Predicted helpfulness |
| `positive_evidence` | `runNoteScores()` | Quality: positive evidence |
| `source_quality` | `runNoteScores()` | Quality: source reliability |
| `breaking_news_risk` | `runNoteScores()` | Risk: breaking news situation |
| `pedantry` | `runNoteScores()` | Risk: pedantic correction |
| `note_not_needed` | `runNoteScores()` | Risk: note unnecessary |
| `tangential_correction` | `runNoteScores()` | Risk: tangential to main claim |
| `rater_verifiability` | `runNoteScores()` | Quality: can raters verify? |
| `overconfidence` | `runNoteScores()` | Risk: overconfident language |
| `pred_source_count` | `countSources()` | Number of sources cited |

### canonical_note_information.data_tier

| Value | Meaning |
|-------|---------|
| `platinum` | Highest quality — snapshots agree, data consistent |
| `gold` | Good quality data |
| `silver` | Acceptable quality |
| `junk` | Contradictory/unreliable snapshots — excluded from enrichment |
| `impossible` | Logically contradictory (e.g. CRH but shown_on_x=false) |
