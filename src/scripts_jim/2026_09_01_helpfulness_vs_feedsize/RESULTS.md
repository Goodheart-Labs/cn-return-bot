# Helpfulness probability vs. feed size and velocity (GOO-92)

Analysis date: 2026-09-07. Scripts in this folder, run in order: `pull_data.py`,
`build_frame.py`, `hypotheses.py`, `surfaces.py`, `simulate.py` (all via
`uv run` from the workspace root; data lands in the gitignored `data/`).

## Definitions

- **Velocity** is impressions per hour at the moment we fetched the post:
  `tweets.impressions / max(age_in_hours, 0.25)`. The `tweets` table is
  insert-only, so this exactly reconstructs the pipeline's own
  `velocityPerHour` at decision time.
- **Feed tier** is the `feed_size` parameter we send to X's eligible-posts API
  (`small` ⊂ `large` ⊂ `xl`), recorded per note in
  `pipeline_runs.ab_test_picks->>'feed_size'`.
- **Floor eras**: before 2026-07-21 there was no velocity floor (selection was a
  soft `0.8 × recency + 0.2 × log-impressions` ranking); then 30k until Jul 28,
  15k until Aug 24, and 5k since. The one-week 30k era is pooled with the 15k
  era everywhere below ("high floor").
- **Settled** means `cn_status` is CURRENTLY_RATED_HELPFUL or
  CURRENTLY_RATED_NOT_HELPFUL. The settled cohort is notes submitted at least
  7 days before the analysis.

## Data

Regular-feed runs Jun 1 to Sep 7 (misinformation-topic path and xxl excluded):
54,126 processed posts with a velocity, 4,780 submitted notes, 689 settled.
Settled by tier: small 215, large 356, xl 118. The pre-floor era contributes
918 submitted notes below 5k/h (large 427, small 158, xl 9), which is what
identifies the sub-5k range; xl has essentially no slow notes in any era.

## Finding 1: higher velocity strongly predicts getting rated at all (hypothesis 2 confirmed)

P(settled | submitted) rises steeply with velocity: odds ratio **1.73 per
tenfold velocity increase** [1.49, 2.00], p < 0.0001, controlling for tier,
era, and note age. This is Jim's second hypothesis and it is clearly right.
At matched velocity, xl notes also settle less than large ones (OR 0.72
[0.56, 0.93], p = 0.01); small vs large is not distinguishable (OR 1.14,
p = 0.20).

## Finding 2: feed tier does not predict helpful-vs-unhelpful once velocity is controlled (hypothesis 1 not supported)

Among settled notes, the raw helpful shares do order the way the theory says:
small 81.3%, large 78.3%, xl 76.1%. But in the model with velocity and era,
the tier block explains nothing (likelihood-ratio test chi² = 1.08, df = 2,
**p = 0.58**; small OR 1.24 [0.79, 1.93], xl OR 0.94 [0.54, 1.63]). The raw
ordering is carried by velocity, not by the tier itself. What is significant
instead: the helpful share among settled notes **falls** with velocity
(OR 0.67 per decade [0.47, 0.96], p = 0.03). Slower posts, when they get
rated at all, fare better. The tier-by-velocity interaction is underpowered
as expected (all p > 0.2) and says nothing either way.

## Finding 3: both outcome rates rise with velocity, and the floor still buys nothing

`helpful_unhelpful_by_tier.png`: P(helpful | submitted) and
P(unhelpful | submitted) both rise with velocity in every tier, because
settling itself does (finding 1). The Aug 5 finding that P(unhelpful) rises
with velocity reproduces. P(helpful | submitted) at the slowest observed bins
(~2-4k/h, pre-floor era) is 0.06-0.08, about half the top-velocity value but
far from zero, so slow posts still produce helpful notes at a solid rate.
`epoch_stability.png`: within their overlapping velocity ranges the eras agree
within their confidence bands; no era looks like a different regime.

## The optimal thresholds

The replay walks the real archived supply (30 full days, Aug 8 to Sep 6,
~103k arrivals) through the ladder's exact selection per 15-minute batch,
with a 690 posts/day budget (the observed recent processing rate), scoring
each pick with era-adjusted surfaces predicted at the current era. Confidence
intervals are a day-level block bootstrap (1,000 reps).

| policy | helpful/day | unhelpful/day | H−U per day [95% CI] |
|---|---|---|---|
| **small off, large off, xl 5k** (best) | 4.57 | 0.87 | **3.70** [3.58, 3.82] |
| current: 5k for every tier | 4.34 | 1.05 | 3.29 [3.15, 3.43] |
| best identified global floor (also 5k) | 4.34 | 1.05 | 3.29 [3.15, 3.43] |

Best per-tier beats the current floor by **+0.41 H−U per day
[+0.37, +0.45]**, about +12%: 5% more helpful notes and 17% fewer unhelpful
ones at the same effort.

Two things the grid makes obvious. First, the xl floor is irrelevant today:
every xl value from 5k to "take nothing from xl" scores identically, because
with small and large unfloored their combined supply (~930 posts/day) exceeds
the 690/day budget and the ladder never reaches xl. Second, the gain does not
come from *differentiating* tiers; it comes from removing the floor on small
and large. So the Aug 5 conclusion survives on much more data: no floor is
better than any tested floor, and per-tier floors add nothing beyond that.

**Recommendation: set `REGULAR_VELOCITY_FLOOR_PER_HOUR` to 0.** If a guard
is wanted for days when small+large supply dips below the budget, a per-tier
configuration of small 0 / large 0 / xl 5,000 is the version every number in
this analysis supports (slow xl is the one region no era ever measured).

## Reproduction check against the Aug 5 analysis

Run `simulate.py --aug5` (per-day pooling, their four supply days, their
670/day budget): no-floor beats the 15k floor on both metrics, with the same
−32% unhelpful reduction they reported. Absolute levels come out ~40% lower
than theirs because our surfaces predict at the current era (which submits a
smaller share of processed posts) and because settlement was still accruing in
their younger data. The policy contrast, which is what the simulation is for,
reproduces; the levels are not comparable across the two analyses.

## Caveats

- **Settlement keeps accruing past 7 days.** `settling_over_time.png` shows
  the settled-helpful share roughly doubling between note ages 7 and 30 days.
  The helpful-vs-unhelpful split is stable across horizons (7d vs 14d cohorts
  differ by under 1 point), so the model conclusions stand, but all absolute
  H/day and U/day levels in the table undercount eventual outcomes. Policy
  comparisons share the bias and largely cancel it.
- This settling figure is cross-sectional (current status by note age), not a
  true competing-risks estimate, because settle timestamps are not stored on
  `notes`. Deriving them from `public_data_snapshots` is a possible follow-up
  if this ever needs to be exact.
- **Slow xl is unmeasured in every era** (9 notes ever). Any policy that
  would actually reach slow xl posts leaves the data.
- **Pre-floor notes are not a random sample** of slow supply; the soft ranking
  still preferred big recent posts. The sub-5k levels lean on that era alone.
- **Tier is not randomized**, so tier contrasts are descriptive, not causal.
- **The simulation assumes invariance**: surfaces fixed under policy change,
  one specific 30-day news window, no rater-supply feedback.
- Statuses can flip; everything here is as of 2026-09-07.
