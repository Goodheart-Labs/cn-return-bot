# Why are we writing fewer notes than we used to? (GOO-91, measured 2026-09-01 and re-measured 2026-09-07)

Investigated: the regular X/Twitter pipeline (Create Notes Routine), prompted
by Nathan's report that the bot "is currently not producing a lot of notes".
The answer has three chapters. The first two were already known; the third is
new and is the one that matters now.

## The fact

Submitted notes per day (`notes.submitted_at`):

| period | notes/day | what was going on |
|---|---|---|
| Aug 10 - Aug 20 | 52 - 111 (avg ~81) | healthy baseline |
| Aug 21 - Aug 22 | 0 | OpenRouter monthly key limit |
| Aug 23 - Aug 25 | 16 - 20 | Brave search cap starved the prefilter |
| Aug 26 - Sep 2 | 57 - 88 (avg ~69) | recovered |
| Sep 3 - Sep 7 | 42 - 50 | X's writing limit binds and shrinks |

Run volume stayed normal throughout (600-900 pipeline runs/day, cron green
every 30 minutes). Weekly totals show August was the strongest month of the
year (388-524 notes/week), so there is no long-term decline.

## Chapter 1: Aug 21-25, the spend caps (already diagnosed, fixed)

Fully covered by `src/scripts_jim/2026_08_25_pipeline_note_yield/RESULTS.md`:
first the OpenRouter key hit its monthly dollar limit (every LLM call refused),
then the Brave Search API hit its monthly cap and the prefilter read "no search
results" as "no note needed". Fixed by topping up the key, making brave-api the
primary provider, letting the prefilter fail open on empty search, and later
(Sep 2) replacing the search stack with Serper (GOO-70).

## Chapter 2: Aug 26 - Sep 2, recovered but leaking ~30 notes/day

Output was back near baseline. The one real leak: `stale_at_submit` grew from
8.7/day (baseline) to 23-38/day. These are fully written notes discarded at the
submit phase because the tweet was older than the 24h cutoff (48h misinfo). The
key finding (see `stale_ages.py`): on Aug 30 - Sep 1 essentially **all** of
these posts were already past the cutoff when the run started (avg 38-43h old,
max 95h). The chain that caused it: the velocity floor drop to 5k/h (Aug 24)
admits older posts, the cap-filling batches (Aug 30) dig deeper into the pool
where they sit, and nothing checked age at selection.

**Fix in this PR**: `collectFastPosts` now drops posts already past the stale
cutoff at selection, next to the velocity floor, so a doomed post never costs a
pipeline run. The submit-time cut stays as the backstop (posts aging mid-run,
the Pangram pre-pass, the 48h misinfo window).

By Sep 3 the leak had already shrunk to 8-12/day on its own, because the
topic-based misinfo pre-pass (the main source of very old posts) was switched
off on Sep 1 (GOO-94). The fix still matters: it protects the regular path,
where old viral posts keep arriving through the lower floor.

## Chapter 3: since Sep 3, X's writing limit binds and is shrinking

This is the current constraint and it is NOT a pipeline bug. The probe readings
(`writing_limit_probe_readings`, live since Sep 4) show X refusing submissions
at 47 (Sep 3), 48 (Sep 5), and 42 (Sep 7), while `hr_100` (the net-helpful
rate of our last 100 rated notes, which X's formula uses) went negative
(-0.04 to -0.06) and the recent Not-Helpful counts rose. X computes the daily
writing limit from rating quality, so worse ratings mean fewer allowed notes.
`daily_limit_reached` runs (posts skipped because the limit was hit) confirm
the cap bound on Sep 1-3 already.

Tracked in GOO-125 ("Note not-helpful rate rose after the 3 September pipeline
changes, tripping X's punishment cliff"). The ranking + capacity-bar work
merged Sep 3 (submit only the best candidates within remaining capacity) is
the response. Not touched by this PR.

## Scripts in this folder

- `notes_and_funnel.py` - notes/day, runs/day, outcome reasons, prefilter-why
- `longer_horizon.py` - weekly totals since April, note status mix
- `leak_comparison.py` - per-reason daily averages, baseline vs recovered
- `stale_ages.py` - post age at run start for the stale_at_submit losses

All need `PROD_DB_URL` (psycopg2 over the session pooler). After the Sep 5
credential rotation that variable is stale; the re-measurement on Sep 7 used
supabase-js with the service key instead.
