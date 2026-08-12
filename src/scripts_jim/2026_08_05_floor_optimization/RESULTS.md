# Velocity floors, feed tiers, and P(Helpful) / P(Unhelpful)

**Question (Jim, 2026-08-05):** analyze P(Unhelpful) and P(Helpful) given feed
size and velocity; what is the best floor — accounting for the fact that
changing a floor changes which tweets from which tiers get processed at all.

**Decisions locked up front:** regular feed only (no misinfo/pangram);
denominators are per submitted note; objective is the frontier of
E[Helpful] − λ·E[Unhelpful] per day; per-tier floors allowed.

## Data

- **Outcomes**: 33,909 regular-feed pipeline runs June 1 → now (feed_size picks
  reliable from June), of which 3,307 submitted and 2,927 settled (submitted ≥7
  days ago). Velocity = `tweets.impressions` (frozen at first insert) over age
  at first sight, the pipeline's own formula.
- **Supply**: the `feed_tweets` archive added on 2026-08-07 (PR #359) — every
  new post the feed ladder surfaces, below-floor included, with frozen
  first-sight impressions and tier. Four full days (Aug 8–11): ~73 small,
  ~858 large, ~2,178 xl new posts per day.
- **Budget**: last 14 days the pipeline processed ~670 regular posts/day
  (90 small / 333 large / 247 xl) and submitted ~59 notes/day.

## Finding 1 — P(Unhelpful) rises with velocity; floors cannot control it

Within every tier, the unhelpful rate is near zero below ~30k/h and climbs to
5–7% above 60k/h (small: 0–1% below 30k, 7.2% at 60–120k; large: 1–2.5% below
15k, 6.9% above 120k). Unhelpful notes come from the viral top of the feed —
contested posts with hostile raters — not from the slow bottom. A velocity
floor cuts the low end, so it does not reduce the unhelpful rate at all; if U
ever needs direct control, the lever is extra scrutiny (or a cap) at the *top*
of the velocity range.

P(Helpful) meanwhile only collapses below ~2k/h (3.6–4.9%, the display-collapse
zone) and is flat-to-rising above ~4k/h.

## Finding 2 — P(Unhelpful) is tier-driven, and it is xl that pays the cost

Settled rates by tier (whole window; the gaps hold in Jul 1+ and Jul 15+
sub-windows too, so this is not a time artifact):

| tier  | n    | pH    | pU    |
|-------|------|-------|-------|
| small | 1027 | 12.7% | 2.7% [1.9–3.9] |
| large | 1590 | 10.1% | 2.9% [2.2–3.8] |
| xl    | 310  |  9.7% | 5.2% [3.2–8.2] |

xl notes are rated unhelpful about twice as often as small/large, with the
lowest helpful rate. Jim's hunch that P(Unhelpful) is feed-size-driven is
right — and the driver is how much of the budget leaks into xl.

## Finding 3 — the floor's real effect is tier displacement

This is the effect the old drop-the-below-floor-notes replays could not see.
The ladder fills a fixed budget tier by tier, so every large-feed post the
floor rejects is replaced by an xl post. Replaying the real 4-day supply
through the ladder's selection rule (tier rank, then velocity; 670 picks/day):

| policy | picks/day (S/L/XL) | H/day | U/day | H:U |
|---|---|---|---|---|
| current 15k global | 48 / 229 / **394** | 5.96 | 2.42 | 2.5 |
| old 30k global     | 32 / 137 / 334 | 4.38 | 1.90 | 2.3 |
| **no floors**      | 73 / 597 / **0** | **6.46** | **1.65** | **3.9** |
| 2k small+large, xl off | 70 / 498 / 0 | 5.80 | 1.53 | 3.8 |

Under the current floor, 59% of daily picks are xl. With no floor, small +
large supply alone fills the entire budget and the ladder never reaches xl —
helpful notes **up 8%** and unhelpful notes **down 32%** simultaneously. The
15k floor is strictly dominated: it throws away the large-feed 2k–15k band
(pH ≈ 10%, pU ≈ 2%) to buy fast xl posts (pH ≈ 7–13%, pU ≈ 3–7%).

Velocity ordering within a tier makes an explicit floor nearly redundant
anyway: with 858 large arrivals/day and ~600 large slots, selection already
acts as a dynamic ~p30 velocity cutoff on large.

## Frontier over λ

- λ = 1 or 2: no floors (or anything ≤8k on small/large) is optimal — the
  xl-exclusion effect dominates everything else.
- λ ≥ 5: degenerate — "write no notes" wins, because the marginal note's
  eH:eU ratio is ~4:1, so any λ above ~4 says notes are net-negative. λ in the
  1–3 range is the meaningful regime for this objective.

## Recommendation

Set `REGULAR_VELOCITY_FLOOR_PER_HOUR` to **0–2k** (0 is optimal in the sim;
2k trades 0.66 H/day for 0.12 U/day if the display-collapse zone feels
wasteful). No per-tier floors needed: the ladder's tier-rank ordering plus a
full small+large supply already keeps xl out. Keep xl in the ladder as
overflow for thin days — that is exactly what it becomes with the floor gone.

## Caveats

- Only 4 days of supply data; re-run `simulate.py` after a couple of weeks for
  tighter numbers (all scripts re-runnable: `pull_data.py` → `surfaces.py` →
  `simulate.py`).
- The sim pools per day; the real ladder picks per 15-min run (top-k of each
  run's arrivals, not the day's). With ~9 large arrivals per run vs ~7 slots
  this is a mild approximation.
- Objective counts notes, not views. Low-velocity notes get far fewer views,
  so a view-weighted objective would penalize the 0–2k band and favor faster
  posts (including some xl). Worth a follow-up before pushing the floor to 0.
- Per-post LLM cost is unchanged (same 670/day budget), but 0-floor spends
  ~15% of it in the display-collapse zone where most notes are never rated.
- xl fits below 30k/h are extrapolation (the old floors censored that region),
  but no recommended policy selects there.
