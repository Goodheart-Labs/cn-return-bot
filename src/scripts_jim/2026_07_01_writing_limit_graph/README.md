# Writing-limit graph (Plotly + Dash)

Interactive time series of how close we run to X's daily note-writing cap, with
markers for every time we actually hit it.

## What it shows

- **Blue line** — notes submitted in a trailing window (default 24h). This is
  exactly what X's daily cap counts against
  (`SupabaseLogger.countRecentSubmissions`, window from `writingLimit.ts`).
  We don't persist the `writing_limit` value over time — `pipeline_state` is a
  single overwritten key — so this trailing count is the faithful proxy.
- **Red diamonds** — every run where we hit the cap: X rejected a submission with
  its daily-limit error and the rest of that run's queue was recorded as
  `pipeline_runs.outcome_reason = 'daily_limit_reached'`. On a hit,
  `recordDailyLimitHit` sets `writing_limit = trailing-24h count`, so at the 24h
  setting the diamond sits right at the cap X enforced. Its hover reports that
  enforced cap and how many notes the run had to skip.

Controls: trailing-window size (12/24/48h) and time range.

## Run

```bash
uv run src/scripts_jim/2026_07_01_writing_limit_graph/fetch_data.py   # refresh data.json
uv run src/scripts_jim/2026_07_01_writing_limit_graph/app.py          # http://127.0.0.1:8055
```

`data.json` is cached so the app starts instantly; re-run `fetch_data.py` to pull
fresh submissions + limit-hit events from Supabase.
