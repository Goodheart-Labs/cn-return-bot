# Test Pipeline

Run the note-writing pipeline on one or more tweets/videos to verify it works end-to-end.

## Quick start

**Single tweet (most common):**
```bash
bun run src/scripts/runOnVideos.ts --bot opus-main-v2 <tweet-url>
```

**Multiple tweets from a CSV:**
```bash
bun run src/scripts/runOnVideos.ts --bot opus-main-v2 tryout-data/video-tryout.csv
```

## Test data

- `tryout-data/video-tryout.csv` — general tryout set
- `tryout-data/video-testset.csv` — fixed test set for regression checks

## What to check

- Look in the `tryout-results/` and open the newest video_csv_created (which contains the results). Check that they are reasonable