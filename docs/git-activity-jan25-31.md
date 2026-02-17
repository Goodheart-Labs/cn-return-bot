# Git Activity — Jan 25–31, 2026 (All Repos)

## Goodheart-Labs/cn-return-bot

### Jan 25 (Sat)
- **21:08** `eadc1cd` — **Add Puppeteer-based notewriter scraper with click-through modal detection**
  - `src/scripts/scrapeNotewriterClickThrough.ts` (+698 lines)
  - Built the click-through scraper that opens each note's detail modal to get accurate note IDs and statuses, replacing the old text-parsing approach.

### Jan 26 (Sun)
- **12:07** `6a8e7ab` — **Improve scraper with human-like delays and security docs**
  - `src/scripts/scrapeNotewriterClickThrough.ts` (+20/-11)
  - Added randomized delays to mimic human behavior. Security documentation.

### Jan 27 (Mon)
- **10:24** `e430c7b` — **Add opus-concise bot, retire opus-scored/strict, enable tweet retries** (PR #20)
  - 9 files, +767/-321
  - New `opus-concise` bot config. Moved `opus-scored` and `opus-strict` to `src/bots/legacy/`. Tweet retry logic. New Supabase queries.
- **10:50** `29dcb29` — **Merge PR #20** (opus-concise-and-retry-logic)
- **11:00** `7a5b223` — **Add scraper coverage check, pipeline stats table, and new Supabase queries**
  - 3 files, +1268/-269
  - Major report upgrade: pipeline stats table, scraper coverage check, new Supabase helpers.
- **13:49** `7a58f9e` — **Clean up scraper: remove dead code, add retry logic and data validation**
  - `src/scripts/scrapeNotewriterClickThrough.ts` (+44/-65)

### Jan 28 (Tue)
- **09:11** `6449f0b` — **Resolve merge conflict with main in supabaseClient.ts**
- **09:12** `5234e2d` — **Merge PR #21** (scraper-coverage-and-report-pipeline)
- **09:55** `a3376ce` — **Save scraped notes incrementally instead of batch import**
  - `src/scripts/scrapeNotewriterClickThrough.ts` (+60/-73)
  - Scraper now saves each note to Supabase immediately after extraction. Prevents data loss on crash.

### Jan 31 (Fri)
- **15:28** `0a39564` — **Improve report accuracy, add data audit tools, and clean up** (PR #22)
  - 11 files, +730/-18
  - Pipeline table respects time filters. Retry detection excludes filtered/rejected runs. Removed ghost `opus-strict` bot. Unknown-bot error guard. Notes-per-day chart. New scripts: `auditData.ts`, `calculateTotalViews.ts`, `analyzeViewConsistency.ts`, `generateDailyNotesReport.ts`. .gitignore fixes.
- **17:48** `a012c2e` — **Merge PR #22** (scraper-incremental-saving)

---

## Goodheart-Labs/original_bot

### Jan 29 (Wed)
- **23:54** `d0ddb36` — **Remove batch forecasting docs from PR**
- **23:56** `c4dceab` — **Merge PR #26** (claude/railway-api-docs)

### Jan 31 (Fri)
- **11:05** `ddf0039` — **Fix: call _extract_resolution_end_date via research_coordinator**
- **15:43** `25b6c78` — **Add Monte Carlo simulation idea for numeric forecasting**
- **15:52** `06d6e85` — **Add note about Telegram bot for Polymarket betting recommendations**

---

## Goodheart-Labs/ebay

### Jan 31 (Fri)
- **17:49** `4c97022` — **feat: comprehensive pricing, image verification & smart Collectr matching** (PR #8)

---

## Goodheart-Labs/fleet-position-visualiser

### Jan 31 (Fri)
- **12:19** `84027a9` — **Initial commit: interactive map of US naval positions around Iran**
