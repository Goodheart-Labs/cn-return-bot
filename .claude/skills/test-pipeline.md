# Test Pipeline

Run the note-writing pipeline on one or more tweets/videos to verify it works end-to-end.

## Quick start

**Single tweet (most common):**
```bash
bun run src/scripts/runOnVideos.ts --bot opus-main-v2 <tweet-url>
```

**Multiple tweets from a CSV:**
```bash
bun run src/scripts/runOnVideos.ts --bot opus-main-v2 datasets/video-tryout.csv
```

## Test data

- `datasets/video-tryout.csv` — general tryout set
- `datasets/video-testset.csv` — fixed test set for regression checks

## What to check

- Look in `dataset_runs/` and open the newest folder's results CSV. Check that they are reasonable