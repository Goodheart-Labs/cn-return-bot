# Onboarding

How this codebase works, for new contributors.

## What this project does

We automatically write [Community Notes](https://communitynotes.x.com/) for X/Twitter posts. Community Notes is X's crowdsourced fact-checking system — when enough people rate a note as "Helpful", it gets displayed on the tweet.

The bot runs on GitHub Actions every 15 minutes. It finds tweets that need fact-checking, writes notes with sourced corrections, and submits them via X's Community Notes API.

## How the pipeline works

The bot runs a **two-phase pipeline**:

### Phase 1: Generate Candidates (`src/scripts/generateCandidates.ts`)
1. Fetch eligible tweets from X's Community Notes "needs notes" feed
2. Skip tweets we've already processed
3. For each tweet, randomly select a **bot** (weighted by config)
4. The bot runs its pipeline: **search → write note → verify source**
5. Run X's evaluation API to score the draft note
6. Store passing notes as "candidates" in the `pipeline_runs` table

### Phase 2: Submit Candidates (`src/scripts/submitCandidates.ts`)
1. Fetch all stored candidates from the DB
2. Rank by eval score + freshness (newer tweets preferred)
3. Submit top candidates via X's note-writing API until the daily limit
4. Log submissions to the `notes` table
5. Run prediction scores (non-blocking) to forecast note outcomes

Entry point: `src/scripts/runPipeline.ts` orchestrates both phases.

### What a "bot" is

A bot is a configuration that wires together pipeline stages with specific models and prompts. See `src/bots/types.ts` for the `Bot` interface. Each bot has:
- An `id`, `name`, `description`, and `weight` (for random selection)
- A `runPipeline(post, content)` method that runs search → write → check

Active bots are registered in `src/bots/index.ts`. Bots with `weight: 0` are legacy/disabled. To add a new bot, create a file in `src/bots/`, wire up pipeline stages, and register it in the index.

Example: `src/bots/opus-main.ts` uses Perplexity Sonar for search, Opus 4.5 for writing, Sonnet 4 for source verification.

## Project structure

```
src/
├── api/             # External API clients
│   ├── fetchEligiblePosts.ts   # Gets tweets needing notes from X
│   ├── submitNote.ts           # Submits notes via X CN API
│   ├── supabaseClient.ts       # DB client + SupabaseLogger helper
│   └── getOAuthToken.ts        # X OAuth
├── bots/            # Bot configurations (each is a pipeline wiring)
│   ├── types.ts                # Bot/PipelineResult/PostContent interfaces
│   ├── index.ts                # Bot registry + selection
│   ├── opus-main.ts            # Primary bot
│   ├── opus-multi-source.ts    # Multi-source search variant
│   └── ...                     # More bot variants
├── pipeline/        # Core pipeline stages
│   ├── searchContextGoal.ts    # Perplexity/Sonar search
│   ├── multiSourceSearch.ts    # Multi-engine search (Google, Exa, etc.)
│   ├── writeNote.ts            # Note writing prompt
│   ├── sourceVerification.ts   # Source URL verification
│   ├── candidateRanker.ts      # Ranks candidates by eval + freshness
│   ├── scoringFilters.ts       # Quality filters (positive claims, etc.)
│   ├── predictionScores.ts     # Post-submission outcome predictions
│   ├── mediaAnalysis.ts        # Video/image analysis
│   └── llm.ts                  # OpenRouter LLM client
├── filters/
│   └── noteEvaluationFilter.ts # X's evaluation API gate
├── scripts/         # Runnable scripts
│   ├── runPipeline.ts          # Main entry point (GH Actions runs this)
│   ├── generateCandidates.ts   # Phase 1
│   ├── submitCandidates.ts     # Phase 2
│   ├── updateNoteFeedback.ts   # Daily public data dump import
│   ├── scrapeNotewriterClickThrough.ts  # Scraper for tracking our notes
│   ├── analyzePerformance.ts   # Performance analysis
│   └── ...                     # Many analysis/debug scripts
├── utils/
│   └── retweetUtils.ts         # Quote tweet handling
migrations/          # Supabase SQL migrations (applied manually)
docs/                # You are here
.github/workflows/   # GH Actions cron configs
```

## Database (Supabase)

We use Supabase (hosted Postgres) for all persistent data. The JS client is in `src/api/supabaseClient.ts`, which provides a `SupabaseLogger` class with helper methods for common operations (creating pipeline runs, fetching candidates, logging submissions, etc.).

Connection uses `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` from `.env`. The service key has full admin access — there's no row-level security. Migrations live in `migrations/` and are applied manually.

### Tables

**Pipeline tables** (written by the bot every 15 min):
- `pipeline_runs` — Every tweet processed, with outcome (candidate/submitted/rejected/failed/expired), bot_id, note text, search results. One row per tweet per run.
- `pipeline_scores` — Scores attached to pipeline runs (evaluation, source_count, predictions). Foreign key to pipeline_runs.
- `notes` — Successfully submitted notes (since Jan 7, 2026). Has note_id, tweet_id, bot info, evaluation_score, cn_status. The "source of truth" for what we've submitted.
- `run_snapshots` — Per-run backlog/processing stats (how many tweets available, how many processed).
- `bot_configs` — Bot configurations (auto-created on first use).
- `notewriters` — Notewriter accounts.

**Tracking tables** (written by feedback scripts and scraper):
- `canonical_note_information` — One row per note we've written. Combines data from scraper + public data dumps. Has cn_status, view_count, data quality tier, coherence score. This is the canonical record for "how is this note doing?"
- `scraped_notewriter_snapshots` — Raw time-series data from the notewriter page scraper. Multiple snapshots per note over time. See `docs/snapshot-reconciliation.md` for the quality tier system.
- `public_data_snapshots` — Daily snapshots from X's public CN data dumps. Tracks status of our notes AND helpful competing notes on the same tweets. One row per note per day.
- `competing_notes` — Other people's notes on tweets where we also wrote notes. Useful for understanding why our note did/didn't get rated helpful.

### Data sources and how they flow

The bot has **three ways** of learning how its notes are doing:

1. **The pipeline itself** writes to `pipeline_runs`, `pipeline_scores`, `notes`, `run_snapshots` every 15 minutes.

2. **X's public data dumps** (`src/scripts/updateNoteFeedback.ts`) — X publishes TSV files daily at `https://ton.twimg.com/birdwatch-public-data/YYYY/MM/DD/`. This script runs daily via GH Actions (`update-note-feedback.yml` at 6 AM UTC). It downloads `notes-00000.tsv` and `noteStatusHistory-00000.tsv`, finds our notes by author participant ID, extracts statuses, and upserts into `canonical_note_information`, `competing_notes`, and `public_data_snapshots`. This is the most reliable source for note status (Helpful/Not Helpful/Needs More Ratings).

3. **The notewriter page scraper** (`src/scripts/scrapeNotewriterClickThrough.ts`) — Connects to local Chrome, scrolls through the notewriter page, clicks each note to extract note ID, status, and view count. Writes to `scraped_notewriter_snapshots`. This is the **only source for view counts** (public data dumps don't include them). See `docs/snapshot-reconciliation.md` for how raw snapshots are reconciled into canonical data.

### Note statuses (from X)
- `CURRENTLY_RATED_HELPFUL` (CRH) — Displayed on the tweet. This is the goal.
- `CURRENTLY_RATED_NOT_HELPFUL` (CRNH) — Rated but not helpful. Bad.
- `NEEDS_MORE_RATINGS` (NMR) — Not enough ratings yet. ~79% of our notes stay here forever.

## Key concepts

### Pipeline outcomes
A pipeline run ends with one of these outcomes:
- `candidate` — Passed all checks, stored for submission
- `submitted` — Successfully submitted to X
- `rejected` — Failed quality checks (no_correction_needed, check_failed, low_evaluation_score, scoring_filters_failed, source_trust_failed)
- `failed` — Technical error (bot_error, bot_returned_null, check_error)
- `expired` — Candidate was superseded (rerolled, tweet_deleted)

### The evaluation gate
After writing a note, we call X's evaluation API to score it. Notes scoring below 0 are rejected. The eval score (sigmoidified) plus a freshness decay (0.02/hour) are used to rank candidates for submission.

### Daily note limit
X enforces a daily writing limit based on your recent note quality. The formula: `WL = max(5, floor(min(DN_30 * 5, WL_L)))`. If 3+ of the last 5 rated notes were "Not Helpful", the cap drops to 5. The bot submits notes in ranked order until hitting this limit.

## Getting started

### Prerequisites
- [Bun](https://bun.sh/) installed (`curl -fsSL https://bun.sh/install | bash`)
- Access to the project's Supabase instance
- API keys (see `.env.example`)

### Setup
```bash
git clone <repo-url>
cd cn-return-bot
bun install
cp .env.example .env
# Fill in .env with real values (ask Nathan for keys)
```

### Run locally
```bash
# Run the full pipeline (same as what GH Actions does)
bun run src/scripts/runPipeline.ts

# Or run phases separately
bun run src/scripts/generateCandidates.ts
bun run src/scripts/submitCandidates.ts
```

### Common tasks
```bash
# Check how notes are performing
bun run src/scripts/analyzePerformance.ts

# Debug a specific note (DB lookup)
bun run src/scripts/debugNote.ts <note-id>

# Run pipeline on videos from any platform (uses yt-dlp)
bun run src/scripts/runOnVideos.ts input.csv
bun run src/scripts/runOnVideos.ts --bot opus-main https://x.com/... https://youtube.com/...

# Tryout pipeline on specific tweets (no submission)
bun run src/scripts/tryoutNotes.ts <tweet-id> [<tweet-id> ...]
bun run src/scripts/tryoutNotes.ts --skip-existing <tweet-id>

# Check posting stats (daily limit, etc.)
bun run src/scripts/checkPostingStats.ts

# Manually trigger daily feedback update
bun run src/scripts/updateNoteFeedback.ts
```

## Gotchas

- **Bun, not npm** — everywhere, including CI
- **OpenRouter model IDs** use slashes and dots: `anthropic/claude-opus-4.5`, not `claude-opus-4-5-20251101`
- **Supabase 1000-row limit** — JS client silently truncates at 1000 rows. Use `SupabaseLogger.fetchAllRows()` to paginate
- **Supabase `.neq()` excludes NULL** — `.neq("col", "val")` drops rows where col IS NULL. Use `.or("col.neq.val,col.is.null")` instead
- **Env var naming** — `.env` uses `SUPABASE_SERVICE_KEY` (not the Supabase default `SUPABASE_SERVICE_ROLE_KEY`)
- **Don't delete database entries** without confirming with Nathan
