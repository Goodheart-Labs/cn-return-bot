# Main Report (`generateMainReport.ts`)

HTML report generated from Supabase data showing bot performance and note outcomes.

## Data Sources

| Table | Fields Used | Purpose |
|---|---|---|
| `canonical_note_information` | note_id, tweet_id, cn_status, view_count, data_tier, first_seen_at, rating_count, helpful_count, not_helpful_count, current_decided_by | Primary note data (public data enriched) |
| `notes` | note_id, bot_name, submitted_at | Bot name mapping and submission date |
| `pipeline_runs` | bot_id, outcome, created_at, tweet_id, has_video | Pipeline attempts, video detection |
| `competing_notes` | tweet_id, note_id, our_note_id, current_status | Notes by other authors on same tweets |

## Report Sections

1. **Summary Cards** - Total notes, helpful rate, total views, awaiting ratings, competing notes
2. **Active Bots** - Side-by-side: status counts | status breakdown %
3. **Legacy Bots** - Side-by-side: status counts | status breakdown %
4. **All Outcomes by Bot** - Stacked bar: helpful + not helpful + needs more + rejected + failed
5. **Weekly Helpful vs Not Helpful** - Bar chart with net helpful line
6. **Notes Per Day** - Daily stacked bar by bot
7. **Pipeline Attempts** - Table with submit rates per bot
8. **Current Bot Weights** - Hardcoded from `src/bots/index.ts`

## Filters

- **Time**: All / 30d / 7d — filters notes by submitted_at and pipeline runs by created_at
- **Video**: All / No Video / Video Only — filters by has_video from pipeline_runs

## Hardcoded Values

Only the active/legacy bot lists are hardcoded:
- `activeBots`: Current production bots (update when adding/retiring bots)
- `legacyBots`: Retired bots kept for historical data
- Bot weights table: Should match `src/bots/index.ts`

Everything else comes from live Supabase queries.

## Running

```bash
bun run src/reports/generateMainReport.ts
```

Output: `tmp/reports/full-bot-report.html` (auto-opens in browser)

## Adding a New Bot

1. Add to `activeBots` array in `generateMainReport.ts`
2. Add a color in `botColors` map
3. Update the bot weights table in the HTML
4. When retiring, move from `activeBots` to `legacyBots`
