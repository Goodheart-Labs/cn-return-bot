# CN improvement week — what we actually learned (2026-07-30)

Written forecast-style: graded considerations first, conclusions only as far as they emerge. Supersedes the "portfolio manager" framing (rejected 07-30 — snappy, not true). Companion to `improvement-menu-2026-07-25.md` (the intervention menu + backtest numbers).

## Considerations — solid

- **Submission order matters, coarsely.** Notes submitted at the top of the per-session eval-sort do much better than ones submitted deep (~80% vs ~50% helpful-of-rated). The coarse cut is real; fine-grained rank-1-vs-rank-7 claims overread small n.
- **Timing failures are about a poor model of raters** The note writer struggles to distinguish between two things which humans see clearly - a tweet that was right at the time but is wrong now ("the score is 1-1" "Charlie Kirk is injured" ) and one that was always wrong ("Obama met with Epstein." )
- **Eval score is a moderate, monotone predictor** (AUC 0.67; curve: <0 ≈ +2%, [0,0.5) ≈ +5%, [0.5,1) ≈ +7%, ≥1 ≈ +13–15%). The only live scorer with signal. Blind spot: flat on whether anyone rates the note at all.
- **~85% of our notes never receive a single rating.** That fraction dominates the hit-rate arithmetic X uses to set our cap (net HR = rated-at-all × quality-if-rated ≈ 0.13 × 0.33). And this is right right, it's the max of last 100 last two weeks and overall, all of which have total on the denominator. 
- **Trivia share:** 36% of our 726 helpful notes correct falsehoods with no real victim (sports stats, viral fluff); they carry 37% of view-mass — views neither concentrate in weighty topics nor skew worse than note-count.
- **Important note** We don't really know how to trade off important views vs trivial. 
- **Economics:** ~$18/helpful note; ~$0.15 per 1k raw views; ~$0.24–0.27 per 1k importance-weighted views. Cheap by any media benchmark; marginal cost of scaling looks ~flat so far.
- **Spending** Nathan thinks we could spend up to double easily. 
- **Cap mechanics:** quality-bound (+~3 cap/day per +1pp net HR_100); NH_5 cliff (3 of last 5 rated NH → cap 5) is annoying but since it's by time rated largely fine. Not clear that our cap mechanics are the right way to run it though.
- **Ship record: one thing all week (#323).** This is a secondardy project

## Considerations — weak

- Feed-queue depth barely matters within the current 20/run. The July head-of-queue inversion is probably a misinfo-pre-pass artifact. This is a possible thing to change/fix
- Note-request posts showed much better rated-at-all (15H/0U, ~23% rated) — promising, small n, unreplicated, idle since Jul 5.
- "Steering toward important topics costs cap" — reasoned (trivia = ⅓ of helpful volume feeding the cap), never measured. How to balance?
- Sessions are jagged (44% submit zero; mean ~1.1/session since Jul 15) — motivates a floor on scarce slots, though the flat-floor version may suffice. Seems something here?

## The large-scale arguments that survive — three, not one

1. **Failures are mostly about what raters count as legitimate help, not factual error.** Did-not-engage, pedantic, and timing are all "true, but not the kind of correction people wanted." Nathan's hand tags said this in June; every analysis since has confirmed it.
2. **Submitting weak notes has a mechanical cost through X's cap formula.** No metaphor required — every submitted note enters the HR denominator, so below-average notes shrink future capacity. This alone justifies the eval floor.
3. **Most notes are never seen by a rater**, and we could think about predicting this better.


## State (2026-07-30)

- **Live:** PR #323 time-travel A/B (verified on public dashboard; first-day split noise; read ~mid-Aug via tag-rate per arm + abstention guard).
- **Awaiting "go" (ready, evidence-backed, small):** stale-tweet cutoff (>24h); flat eval floor 0.5 v1.
- **Designed, unbuilt:** quantile top-S floor; 2–3× candidate pool (+$30/day); request-targeting; materiality judge; north-star metric (important-suppressed-views per $ — suppressed-vs-raw choice open).
- **Process rule proposed:** WIP limit of one — new analysis threads park until the ripe item ships.
