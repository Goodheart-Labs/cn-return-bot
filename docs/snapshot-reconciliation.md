# Snapshot Reconciliation System

## Overview

We scrape the X notewriter page repeatedly, producing `scraped_notewriter_snapshots` rows. Each snapshot captures a point-in-time observation of a note: its note_id, tweet_id, cn_status, note_text, view_count, etc. Scraping is imperfect — modals may not render fully, the scraper may grab the wrong tweet link, tweets get deleted. This system classifies snapshots by quality and resolves conflicts to produce reliable canonical data in `scraped_notewriter_notes`.

## Data Flow

```
Multiple scrape runs
        ↓
scraped_notewriter_snapshots (raw time-series)
        ↓
  [1] Quality Tier Classification
        ↓
  [2] Collision Detection & Quarantine
        ↓
  [3] Majority Vote Resolution
        ↓
scraped_notewriter_notes (canonical, one row per note)
```

## Step 1: Quality Tiers

Each snapshot is classified independently into one of five tiers.

### Platinum — cross-validated, complete
- note_id/tweet_id pair matches `notes` table ground truth (the bot records both at submission time)
- cn_status is a recognized status (not UNKNOWN)
- note_text is present and non-empty

### Gold — complete, unverifiable
- Has a real note_id/tweet_id pair
- Neither the note_id nor tweet_id appears in the `notes` table (can't cross-check)
- cn_status is a recognized status (not UNKNOWN)
- note_text is present and non-empty

### Silver — mostly complete, one thing missing
- Has note_id, cn_status is real, note_text is present
- tweet_id is `post_unavailable` (tweet was deleted — detected explicitly) or null/`unavailable_*`
- OR: has the pair but cn_status is UNKNOWN
- OR: has the pair but note_text is missing
- OR: CRH but view_count is missing (view count element may not have loaded)

### Junk — don't use for canonical data
- note_id/tweet_id pair contradicts `notes` table ground truth
- cn_status is UNKNOWN AND note_text is missing (got basically nothing)
- Multiple fields missing

### Impossible — data actively contradicts itself
- cn_status is CURRENTLY_RATED_HELPFUL but shown_on_x is explicitly false (CRH notes are by definition shown on X)

## Step 2: Collision Detection

After tier classification, check all non-junk snapshots for pairing collisions. The note_id↔tweet_id mapping is 1:1 (each note belongs to exactly one tweet, each tweet has at most one note from us).

### Types of collision
- **Same note_id, different tweet_ids** across snapshots: the scraper grabbed different tweet links on different runs
- **Same tweet_id, different note_ids** across snapshots: two notes claiming to be about the same tweet

### Quarantine
Any snapshot involved in a collision is quarantined — pulled out of its tier temporarily. Quarantine is NOT junk. Quarantined snapshots retain their tier and participate in resolution.

## Step 3: Majority Vote Resolution

For each collision:

1. Count how many snapshots support each pairing
2. If a `notes` table ground truth exists for either ID, that wins automatically (platinum-level trust)
3. Otherwise, the majority pairing wins
4. **Winners** return to their original tier and are used for canonical data
5. **Losers** also return to their original tier — they are NOT discarded. If a future scrape adds evidence that flips the majority, the old loser can become the new winner
6. **No majority** (exact tie): no winner is declared. The canonical tweet_id for that note is set to null until a future scrape breaks the tie

Nothing is permanently discarded from non-junk tiers. Only the current consensus changes.

## Coherence Scoring

Each canonical note gets a `coherence_score` (0.0–1.0) measuring how consistent its underlying snapshots are. Starts at 1.0, with penalties:

| Signal | Penalty | Rationale |
|---|---|---|
| Note text differs across snapshots | -0.4 | Notes can't be edited on X — different text = scraper grabbed wrong modal |
| View count decreases over time | -0.3 each | Views are monotonically increasing — decrease = data corruption |
| Status flips (helpful ↔ not helpful) | -0.2 each | Rare but possible; surprising enough to flag |
| Status regresses (rated → needs more) | -0.1 each | Unusual but less alarming |
| Needs more → rated | 0 | Normal progression |

Single-snapshot notes get 1.0 (nothing to contradict). Score floors at 0.0.

## Deriving Canonical Data

For each unique note_id, select the best available snapshot:

1. If all snapshots for a note are junk, set canonical tweet_id to null — we know the note exists but don't trust any data for it yet
2. Take the highest-tier non-junk snapshot (platinum > gold > silver)
3. Within the same tier, prefer the newest snapshot (most recent scrape)
4. For colliding pairs, only use the current majority-vote winner's pairing. If no majority (tie), set tweet_id to null
5. Write the result to `scraped_notewriter_notes`

### Fields derived
- `note_id` — from snapshot
- `tweet_id` — from winning pair (or `post_unavailable` for deleted tweets, or null if unresolved)
- `cn_status` — from the selected snapshot (new column)
- `note_text` — from the selected snapshot
- `view_count` — from the selected snapshot (new column)
- `source_url` — from the selected snapshot (if available)
- `data_tier` — platinum/gold/silver/junk (new column)
- `coherence_score` — 0.0–1.0 consistency measure across snapshots (new column)
- `last_reconciled_at` — timestamp of last reconciliation run (new column)

### Migration: `scraped_notewriter_notes`
Add columns: `cn_status`, `view_count`, `data_tier`, `last_reconciled_at`. Drop `tweet_id_flag` (replaced by tier system).

### When to run
Reconciliation runs automatically at the end of every scrape (including partial ones). It's idempotent and cheap (~1,400 upserts), so running it after a partial scrape is fine — it just uses whatever snapshots exist so far.

## Ground Truth Sources

| Source | Has note_id | Has tweet_id | Trust level |
|---|---|---|---|
| `notes` table | Yes (from X API at submission) | Yes (bot chose the tweet) | Highest — both recorded at submission |
| `public_data_snapshots` | Yes | Yes | High — from X's public data dumps |
| `scraped_notewriter_snapshots` | Yes (from modal) | Yes (from cell link) | Variable — depends on tier |

## Scraper Improvements (Feb 18, 2026)

To reduce junk rate:
- **Modal wait**: Waits for status text to appear, not just "Note ID"
- **Cell status fallback**: If modal gives UNKNOWN, uses status from cell text
- **Smart tweet_id**: Skips `/status/` links inside note text body, only grabs parent tweet link
- **Post unavailable detection**: Explicitly detects "Post unavailable" text → records `post_unavailable` (distinct from `unavailable_*` which means scraper couldn't find any link)

## tweet_id Values

| Value | Meaning |
|---|---|
| `1234567890123456789` | Real tweet ID extracted from cell |
| `post_unavailable` | Tweet was deleted — "Post unavailable" shown in cell |
| `unavailable_<noteId>` | Scraper couldn't find any tweet link (ambiguous — could be deleted or scraper bug) |
