# Why the X pipeline stopped producing notes (2026-08-25)

Investigated: the regular X/Twitter Community Notes pipeline (`runPipeline.ts`,
the Create Notes Routine workflow). Not the everything pipeline.

## The fact

Submitted notes per day (`notes.submitted_at`):

| period | notes/day |
|---|---|
| Aug 12 – Aug 20 | 79 – 111 |
| Aug 21 – Aug 22 | **0** |
| Aug 23 – Aug 24 | 16 – 21 |
| Aug 25 (to ~11:00 UTC) | 3 |

Run volume stayed normal the whole time (800–960 runs/day), and the cron kept
dispatching on schedule. The loss is not in ingestion, not in the velocity
floor, not in submission, and not a dashboard artifact. It happened in two
distinct stages, both of them provider spend caps, not code.

## Phase 1 (Aug 21 00:00 – Aug 23 06:00 UTC): OpenRouter key limit

Every run failed with
`[model: deepseek/deepseek-v4-flash] 403 Key limit exceeded (monthly limit)`
(899, 891, 260 failures on Aug 21/22/23). The OpenRouter API key has a
monthly dollar limit; it ran out and every LLM call was refused. The error
names deepseek because the prefilter's query writer is the first OpenRouter
call in a run. Warning signs existed on Aug 20: eleven
`402 This request requires more credits` failures on sonnet-5/fable-5 calls.

The key was topped up / the limit raised around Aug 23 05:30 UTC and runs
resumed at 06:00. The everything pipeline spends on the same key and spiked to
$35–56/day on Aug 17–19, which is likely what pulled the limit forward.

## Phase 2 (Aug 23 12:00 UTC – ongoing): Brave Search API cap → prefilter kills everything

After the recovery, the prefilter went from rejecting ~60% of posts to ~91%.
The reason breakdown (from `logs->note_prefilter_steps->verdict`) shows why:

| prefilter "no" reason | Aug 15–20 (per day) | Aug 24 |
|---|---|---|
| judge read findings, said no | ~300–370 | 28 |
| query writer: no checkable claim | ~140–230 | 173 |
| **every search query returned zero results** | **~0–2** | **539** |

From 12:00 UTC on Aug 23, sharp to the hour, every SearXNG search in CI
returns nothing. The prefilter treats "no evidence found" as "no note needed"
(`noteNeededPrefilter.ts`), so a total search outage silently masquerades as
the model deciding nothing is noteworthy. The bot itself is unchanged: posts
that do pass the prefilter still convert to submissions at the same ~30% rate
as before.

Why search died: the CI search ladder is scraped google → scraped brave →
paid Brave API (`searxng.ts`). The scraped engines are blocked from
datacenter IPs (verified locally: google answers CAPTCHA, brave answers
"too many requests"), so the paid Brave API has been carrying essentially all
CI search volume. On Aug 23 it hit its monthly usage cap. Verified live:

```
HTTP 402 USAGE_LIMIT_EXCEEDED  current_spend: 105.0  usage_limit: 105.0 (monthly)
```

A `searxng/searxng:latest` image re-push on Aug 22 landed in the same window
but is not needed to explain anything; the image works when run locally.

## The looming third outage

The OpenRouter key (checked Aug 25): limit $200/month, $164.72 used, **$35.28
remaining**, resets Sep 1. The two pipelines together burn $25–50+/day on it
in normal operation. Fixing Brave alone restores full runs and the key dies
again within roughly a day.

## Fixes

Immediate (account dashboards, no code):
1. Raise the Brave Search API monthly usage limit (currently $105). This
   single change restores note yield to ~85/day.
2. Raise the OpenRouter key monthly limit well above ~$60/day × 31 days of
   combined X + everything spend, or split the two pipelines onto separate
   keys so one cannot starve the other.

Code (needs a decision, not done here): the prefilter's "every query returned
zero results" path should not count as "no note needed". Options:
- mark the run `failed` with a distinct reason (e.g. `search_unavailable`) so
  an outage is loud in the funnel stats, or
- fail open and let the post through to the bot (the bot's native grok/sonnet
  search still works during a SearXNG outage) at the cost of higher spend.
Either matches the stated fail-open principle in `velocity.ts` ("a change in
the shape of the feed must never silently stop us from submitting notes").
Monitoring the `zero_search_results` share of prefilter rejections would have
caught this within hours.

## Scripts

- `notes_per_day.py` — notes per week/day (the headline fact)
- `funnel.py` — outcomes, failure messages, prefilter-reason breakdown, hourly pinpoint
- `check_search_providers.py` — live Brave quota + OpenRouter key state probes

All read prod via `PROD_DB_URL` / keys from `.env`; run from the workspace
root with `uv run src/scripts_jim/2026_08_25_pipeline_note_yield/<script>.py`.
