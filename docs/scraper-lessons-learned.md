# Scraper Lessons Learned (Jan 2025)

## The Problem
We needed to sync `cn_status` and `view_count` from X.com's notewriter profile page back to our `notes` table in Supabase.

## What We Tried

### Browser Scraper Approach (Failed)
Built 3 versions of a browser console scraper to extract note data from the notewriter profile page.

**Our rough guess why it failed:**
1. **React Virtual Scrolling** - X.com only renders ~8-15 note cells at a time, regardless of how many notes exist. Scrolling triggers DOM mutations that replace elements rather than adding new ones.

2. **Missing `/status/` Links** - Not all note cells contain a tweet link. Perhaps quote tweets and deleted tweets don't have the expected anchor structure, causing our tweet_id extraction to fail silently. Generaly unclear.

3. **Wrong Tweet ID Extraction** - Our fallback method (using `data-testid` attributes) grabbed incorrect IDs from nested elements.

### Sync Script Approach (Partial Success)
Created `syncScrapedToNotes.ts` to match notes between tables using `tweet_id`.

**Why it was limited:**
- Only 16 of 63 bot-submitted notes matched tweet_ids in the scraped table
- The scraped table had different note_ids (X's internal IDs vs our generated IDs)
- 46 notes were completely unmatchable

## What Actually Worked

**Manual data entry.** User scrolled through the notewriter page and copied status/view data into a structured format. Script parsed and uploaded to Supabase.

Time spent on scraper: ~2 hours
Time spent on manual entry: ~15 minutes
Notes successfully updated: 63/63 (100%)

## Recommendation

For small datasets (<100 notes), manual collection is faster and more reliable than fighting X.com's anti-scraping measures. The browser scraper approach might work for continuous monitoring but requires:
- MutationObserver with careful deduplication
- Multiple extraction strategies per cell
- Acceptance of incomplete data

For our use case: **just do it manually when needed.**
