# Making the vote donation decay faster (2026-07-21)

Follow-up to [2026_07_17_donation_scoring](../2026_07_17_donation_scoring/RESULTS.md).
Script: `decay.py`.

> **Shipped 2026-07-21.** `src/everything-web/src/lib/donationScoring.ts` now runs
> the shrinking-stake scheme with the threshold pinned to X's CRH bar (Jim's call)
> — prior Beta(1.68, 3.32), t = 0.40, Brier, **b = 6.25**, $0.25 tip. Settlement:
> p ≥ 0.78 → helpful, p ≤ 0.20 → not helpful, and **Somewhat adds 0.5 to the
> helpful side only** (Jim, 2026-07-21 — reversing the 0.5/0.5 reading below). (b was 5 in the
> derivation below; raised to 6.25 to lift every amount 25% — the tip is additive,
> so the $0.25 floor is unchanged and the *shape* of the decay is identical.) `donationScoring.test.ts` pins the port to the fixtures this script
> generates — see `print_shipped_schedule()` for the table below.
>
> | vote | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
> |---|---|---|---|---|---|---|---|---|---|---|
> | p before | 0.35 | 0.58 | 0.75 | 0.86 | 0.92 | 0.96 | 0.98 | 0.99 | 0.995 | 0.998 |
> | $ this vote | 3.08 | 2.36 | 1.63 | 1.07 | 0.71 | 0.50 | 0.38 | 0.32 | 0.28 | 0.27 |
> | $ cumulative | 3.08 | 5.44 | 7.07 | 8.14 | 8.85 | 9.35 | 9.73 | 10.05 | 10.33 | 10.60 |

## The problem

Live formula: `D = 0.8 · (base + b · max(Δ log-score, −clip))` with `base = $1.50`,
`b = 5`, and an independent-votes belief model (each vote moves log-odds by a fixed
0.40). Ten unanimous Helpful votes pay:

| vote | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| live | 2.16 | 2.01 | 1.85 | 1.70 | 1.58 | **1.47** | 1.39 | 1.34 | 1.29 | 1.26 | 16.05 |

The score term does decay, but the **flat $1.20 base floors everything**. The 10th
pile-on vote costs almost as much as the first. Target: 6th vote ≈ $0.50.

## Two independent causes, two fixes

1. **The base doesn't decay.** It's a participation payment, not information.
2. **The belief model never runs out of information.** Under independent votes,
   `p → 1` forever and every vote is "fresh evidence".

A third problem blocks the naive fix: dropping the base makes the *losing* side of
the pair deeply negative (−$1.98) and, under the **log** rule, that loss never
shrinks — at p = 0.98 a Helpful vote still displays "−$1.98 if it ends up not
helpful". Both numbers are shown on the vote card, so that's a real UX regression.

## Models tried

- **Independent** (live): `logit p = logit p₀ + w_H·h − w_U·u`.
- **Redundant voters**: the k-th person to agree is partly echoing the first, so its
  evidence is discounted `ρ^k`. Total movement bounded by `w/(1−ρ)`. Decays hard but
  the cap is arbitrary and it flattens at p ≈ 0.81 no matter how many people vote.
- **Latent quality** (Bayesian, no decay knob): the note has a latent θ = share of
  raters who'd call it helpful, votes are iid Bernoulli(θ), the note settles Helpful
  iff θ > t. Beta(1.6, 1.6) prior, t solved so p₀ = 0.35. Information genuinely runs
  out: once θ is pinned down the residual uncertainty is irreducible.

And two scoring rules: **log** (unbounded loss) vs **Brier** `1−(1−p)²` / `1−p²`
(proper, but bounded — as Δp → 0 the payout → 0 on *both* sides).

## Recommendation: shrinking stake (latent quality + Brier + state-dependent base)

```
base(tally) = tip + b · max over (vote v, outcome o) of  [ S_o(p) − S_o(p_v) ]
D_o         = base(tally) + b · [ S_o(p_after) − S_o(p_before) ]
```

with `tip = $0.25`, `b = 5`, Beta(1.6, 1.6), t from p₀ = 0.35.

The base is the **stake still on the table**: exactly the worst score drop any vote
could suffer from here. So the smallest number on the card is always $0.25, and the
whole scale — both sides — shrinks as the crowd converges. It stays
incentive-compatible because the base depends only on the tally you walked into,
never on which way you vote.

| vote | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| if helpful | 2.71 | 2.15 | 1.52 | 1.03 | 0.74 | **0.58** | 0.47 | 0.39 | 0.34 | 0.31 | 10.24 |
| if not helpful | 0.82 | 0.72 | 0.50 | 0.31 | 0.25 | 0.25 | 0.25 | 0.25 | 0.25 | 0.25 | — |

Unanimous Not-helpful votes: 2.14, 1.15, 0.65, 0.43, 0.32, 0.28, … (total $5.99).

Other states:
- 5 Helpful already, you vote Not helpful → **$0.33 / $1.68** (contrarian premium).
- 3 Helpful + 2 Not helpful, you vote Helpful → **$1.87 / $0.73** (disagreement
  restores the stake).

Cost: **$10.24 per 10-vote note** vs $16.05 today.

## How "Somewhat helpful" should behave

**Settled: Somewhat is a fractional Beta update** (`a += 0.5, b += 0.5`) rather
than a no-op. This mirrors X's own rating scale, where the matrix factorization
scores `HELPFUL = 1.0`, `SOMEWHAT_HELPFUL = 0.5`, `NOT_HELPFUL = 0.0`. Either way
it stops being informationally inert, which is the live scheme's real defect.

**Superseded — see the shipped banner at the top.** Jim's final call was the
`(0.5, 0.0)` update after all: a Somewhat vote adds half a Helpful vote and
nothing on the other side, so it can only ever count *for* a note. My objection
below was that this makes Somewhat unfalsifiable positive evidence, so enough of
them alone rate a note helpful — Jim's answer is that this is desirable, not a
bug, which resolves it. The bar stays pinned at X's CRH threshold, 0.40, and the
*rating* thresholds (0.78 / 0.20) were then chosen to bracket specific tallies.

The analysis below compares the two readings on their merits:

| | bar | a Somewhat vote | 2H → 2H+1S |
|---|---|---|---|
| **solve t from our base rate** | θ > 0.615 | pushes p **down** | 0.683 → 0.627 |
| **pin t to X's CRH bar** | θ > 0.40 | pushes p **up** | 0.746 → 0.755 |

Because the solved bar lands *above* 0.5, a middling rating was negative by
construction — an artifact of fitting `t` to our own 35% base rate, not a finding.
The shipped model pins `t` to a real constant and lets an asymmetric prior carry
the base rate; see "Should a Somewhat vote push p up or down?" below for the full
comparison and the caveat on that 0.40.

⚠️ The rest of this section was written against the **solved-threshold** model, so
its figures are superseded by the shipped table at the top of this file. The
band-width finding is the exception — it is about the live scheme's `w_s = 0` and
holds under either bar.

### The test: over what band of beliefs is Somewhat the honest click?

A middle option is only meaningful if some non-degenerate range of private beliefs
`q` makes it the best-paying vote.

Expected donation is linear in `q`, so this is the upper envelope of three lines —
solved exactly at their intersections, not sampled.

| state | live | shrinking stake |
|---|---|---|
| fresh note | [0.389, 0.400] — **width 0.011** | [0.241, 0.434] — width 0.193 |
| 5 Helpful already | [0.755, 0.780] — 0.026 | [0.820, 0.897] — 0.077 |
| 3 H + 2 U | [0.415, 0.437] — 0.023 | [0.306, 0.435] — 0.129 |

Today Somewhat is the honest click for essentially nobody, because `w_s = 0` means
it says "I agree with the crowd *exactly*" — a measure-zero belief — while paying a
guaranteed $1.20/$1.20. Worst of both: the safest click on the card and
informationally empty.

### A properness bug in the live scheme, found on the way

Fresh note, expected donation by belief:

| your belief q | 0.20 | 0.35 (the prior) | 0.50 | 0.80 |
|---|---|---|---|---|
| Helpful | 0.88 | 1.12 | 1.36 | 1.84 |
| Somewhat | 1.20 | 1.20 | 1.20 | 1.20 |
| Not helpful | **1.50** | **1.26** | 1.02 | 0.55 |

At the prior belief — i.e. knowing nothing beyond what the crowd knows — **Not
helpful is the best-paying vote** ($1.26 vs $1.20 for the honest no-op). The `clip`
truncates a Not-helpful vote's downside to $0.24 while leaving its $1.81 upside
intact. The Jul-17 writeup expected the clip to "bend properness only at extremes";
it bends it at the centre. Shrinking stake needs no clip (Brier's loss is already
bounded), and its bands are clean: Somewhat wins at q = 0.35, as it should.

### Should a Somewhat vote push p up or down?

Jim's proposal: add 0.5 to the *helpful* side only, so Somewhat never counts
against a note. Three readings, `p` after n Somewhat votes on a fresh note:

| reading | 0 | 2 | 4 | 6 | 8 | 10 | 2H | 2H+1S | 3H |
|---|---|---|---|---|---|---|---|---|---|
| `(0.5, 0.5)`, t solved = 0.615 | 0.35 | 0.31 | 0.27 | 0.25 | 0.22 | 0.20 | 0.683 | 0.627 | 0.785 |
| `(0.5, 0.0)`, t solved = 0.615 | 0.35 | 0.54 | 0.68 | 0.79 | 0.86 | **0.91** | 0.683 | 0.739 | 0.785 |
| `(0.5, 0.5)`, t pinned = 0.40 | 0.35 | 0.44 | 0.50 | 0.55 | 0.60 | 0.63 | 0.746 | 0.755 | 0.856 |
| **`(0.5, 0.0)`, t pinned = 0.40 — SHIPPED** | 0.35 | 0.58 | 0.75 | 0.86 | 0.92 | 0.96 | 0.746 | **0.808** | 0.856 |

(rows 3–4 at prior strength 5.0; see the sweep below. Row 4 is what shipped.)

**`(0.5, 0.0)` is incoherent.** After ten Somewhat votes the posterior is
Beta(6.6, 1.6), asserting θ ≈ 0.80 — that ~80% of raters would say HELPFUL — when
we have just observed ten raters, *none* of whom said Helpful. Because Somewhat
only ever adds to `a`, it is unfalsifiable positive evidence: no quantity of "meh"
can make the model doubt a note, and p → 1 monotonically.

**The culprit was the threshold, not the update.** Adding 0.5/0.5 is simply what
"one rater scored this 0.5" means. What made Somewhat negative is that the solved
`t = 0.6147` sits *above* 0.5 — and that number was reverse-engineered from our own
35% base rate. X's CRH bar is **0.40** on the same 1.0/0.5/0.0 scale, i.e. below
0.5. Pin `t = 0.40` and let an asymmetric prior carry the base rate: Somewhat
becomes mildly positive (2H → 2H+1S rises 0.746 → 0.755, far less than 3H's 0.856)
and, on a strong note, mildly negative. It pulls toward the middle from either
side, which is what a middling rating should do.

Caveat: 0.40 thresholds CN's matrix-factorization note *intercept*, not a raw mean
rating, so reading it as a bar on θ is a modelling liberty. It is a real constant
rather than a fitted one, but it becomes load-bearing and deserves a check against
real note data before shipping.

#### Prior-strength sweep with `t = 0.40` (b = 5)

| prior | v1 | v2 | v3 | v4 | v5 | v6 | v7 | 10-vote total | Somewhat band |
|---|---|---|---|---|---|---|---|---|---|
| Beta(1.05, 2.15) | 3.07 | 2.01 | 1.22 | 0.75 | 0.49 | 0.37 | 0.30 | 8.99 | 0.209 |
| **Beta(1.68, 3.32)** | 2.52 | 1.94 | 1.35 | 0.91 | 0.62 | **0.45** | 0.35 | 8.98 | 0.172 |
| Beta(2.40, 4.60) | 2.16 | 1.82 | 1.39 | 1.01 | 0.73 | 0.53 | 0.41 | 8.97 | 0.142 |
| Beta(3.13, 5.87) | 1.93 | 1.71 | 1.39 | 1.07 | 0.80 | 0.60 | 0.47 | 8.96 | 0.123 |

The 10-vote total is ~$8.98 regardless — it is bounded by the scoring rule's range,
so prior strength trades early-vs-late payout without moving the budget.

### Somewhat under shrinking stake

Fresh note: **$1.51 / $1.74** — a spread of $0.23 against $1.89 for Helpful or Not
helpful. A genuine low-variance hedge, which is the right shape for "I'm not sure".

Two consequences worth accepting deliberately:

1. **The lazy click is rational for an uninformed voter.** Always-Somewhat earns
   ~$1.66/vote regardless of outcome, beating an uninformed Helpful guess ($1.48).
   That is *correct* under a proper rule — but skill still pays: a voter who
   actually knows q = 0.8 earns $2.33 by voting Helpful, a ~40% premium. The lever
   against lazy clicking is rate limits / the earnest gate, not distorting the rule.
2. **Contested notes cost more, not less.** Ten Somewhat votes in a row cost
   **$10.93 if the note settles Helpful, $12.39 if it doesn't** — against $10.24
   for ten Helpful votes on a note that settles Helpful. A note everyone rates
   "meh" stays genuinely uncertain, so the stake never collapses. Defensible
   (contested notes are where information is most valuable) but it is the budget
   worst case, and the *only* run where the settle-Not-helpful side costs more
   than the settle-Helpful side.

## Runners-up

**A — drop the base, keep everything else** (`base = 0`, `b = 9`, log rule,
clip 0.22). One-line change; decay 2.17 → 0.62 at vote 6. But the losing side sits
at −$1.98 forever, and a Somewhat vote pays exactly $0.

**D — latent quality + Brier + flat $0.25 tip** (`b = 11.5`). Both sides shrink,
but early votes still show −$1.69, and the winning side collapses to the tip by
vote 7 (0.31 → 0.25) — less headroom than F.

**B — redundant voters** decays fastest (3.15 → 0.06 at vote 6) but overshoots and
its saturation point is a free parameter rather than something the model derives.

## Tuning grid (shrinking stake)

`a` = Beta prior strength (lower = one vote teaches more), `b` = $/unit score.

| params | v1 | v2 | v3 | v4 | v5 | v6 | v7 | v8 | v9 | v10 | total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| a=1.6 b=5 | 2.71 | 2.15 | 1.52 | 1.03 | 0.74 | 0.58 | 0.47 | 0.39 | 0.34 | 0.31 | 10.24 |
| a=1.6 b=7 | 3.70 | 2.91 | 2.03 | 1.34 | 0.93 | 0.71 | 0.55 | 0.45 | 0.38 | 0.33 | 13.33 |
| a=2.5 b=5 | 2.28 | 1.89 | 1.42 | 1.03 | 0.81 | 0.65 | 0.53 | 0.44 | 0.38 | 0.34 | 9.77 |
| a=4.0 b=5 | 1.89 | 1.64 | 1.32 | 1.05 | 0.88 | 0.73 | 0.60 | 0.51 | 0.43 | 0.38 | 9.43 |

Lower `a` steepens the decay (first vote teaches more); `b` scales the whole card.

## Settlement (added when shipping)

Donations are outcome-contingent, so something has to declare the outcome. Rule:
a note settles once the crowd's estimate is decisive — **p ≥ 0.75 → helpful,
p ≤ 0.25 → not helpful**, otherwise pending.

The two bounds look symmetric but are not, because the 0.35 prior starts much
nearer the floor than the ceiling:

| tally | p | settles |
|---|---|---|
| 1 Not helpful | 0.235 | (would settle on one vote — blocked by the quorum) |
| 2 Not helpful | 0.156 | **not helpful** |
| 2 Helpful | 0.746 | pending — just short of 0.75 |
| 3 Helpful | 0.856 | **helpful** |

So a bare threshold rule would let a *single* Not-helpful vote lock in everyone's
donation. A **quorum of 2 votes** blocks that; Jim chose 2 rather than 3 so that
two Not-helpful votes still settle a note, keeping "this note failed" the cheaper
claim to establish (3 votes the other way).

Settlement is advisory in the UI — the team still fulfils from the ledger by hand.
`VoteDonation` switches from "we will donate $X if… and $Y if…" to naming the one
amount now owed.

## Implementation note

Done. The Beta tail lives in `src/everything-web/src/lib/incompleteBeta.ts` —
Lanczos log-gamma plus the continued fraction, no dependency (the published page
runs under a strict CSP, so a package here is pure bundle weight). Bundle grew
~1 kB gzipped.

Frozen pairs on existing `everything_donations` rows are untouched — they keep the
amounts they were minted with under the old rule, which is the point of freezing
them. Only new votes price under the new scheme, so the ledger holds a mix; the
settlement rule applies to both.
