# Donation formula for Common Notes votes (2026-07-17)

Replace the flat "$2 per vote-with-reasoning" with an outcome-contingent donation
computed by a log market scoring rule. Found via grid search in `search.py`.

## Formula

Each note carries a running log-odds `L` of eventually settling **Helpful**
(prior `L0 = logit(p0)`). Every vote moves it by a fixed step (naive independence):

| vote | ΔL |
|---|---|
| Helpful | `+w_H` |
| Somewhat helpful | `+w_S` |
| Not helpful | `−w_U` |

A vote cast when the note is at `L` (moving it to `L' = L + ΔL`) earns the
donation pair — shown immediately after voting, frozen forever:

```
D_if_helpful   = base_H + b · max( ln p(L') − ln p(L),         −clip )
D_if_unhelpful = base_U + b · max( ln(1−p(L')) − ln(1−p(L)),   −clip )
```

with `p(L) = 1/(1+e^−L)`. Settlement pays one of the two when the note's
outcome locks in.

Why this shape:
- The `b`-term is the log market scoring rule: you are paid the information
  (nats) your vote added toward the realized outcome. Early/contrarian-and-right
  pays a lot; late bandwagoning pays ≈ 0; wrong-direction pays negative.
- `base_H > base_U` makes helpful notes pay more **without distorting
  incentives** — the base depends only on the outcome, not on your vote.
- `clip` floors the score part so the downside can never get scary.
- Per-vote and per-note independent: the two displayed numbers are exact, never
  revised by later votes.

## Search constraints

max donation ≤ $5 · gaps H-vs-S and U-vs-S ≥ $0.45 at the prior ·
helpful-premium ≥ $0.20 · avg cost $1.20–2.80/vote (sim: 8 votes/note, 60 seqs
per outcome) · 5 unanimous H votes reach p ≥ 0.60, 10 stay ≤ 0.98.

## Presets

Common core (all three): `p0 = 0.35, w_H = 0.40, w_S = 0.12, w_U = 0.52, b = 4, base_H = $2.00`.
Only `base_U` and `clip` differ. Tables are $ if-Helpful / $ if-Not-Helpful.

### A — "Never negative"  (recommended) — `base_U = $1.00, clip = 0.24`

worst $0.04 · best $3.60 · avg $1.75/vote (~$14 per 8-vote note)

| context | Helpful | Somewhat | Not helpful |
|---|---|---|---|
| fresh note (p=0.35) | +3.00 / +0.35 | +2.30 / +0.85 | +1.05 / +1.60 |
| consensus-unhelpful (p=0.15) | +3.30 / +0.70 | +2.40 / +0.90 | +1.05 / +1.25 |
| consensus-helpful (p=0.85) | +2.20 / +0.05 | +2.05 / +0.60 | +1.60 / +2.70 |

### B — "Mild sting" — `base_U = $0.75, clip = 0.24`

worst −$0.21 · best $3.60 · avg $1.62/vote (~$13/note). Same as A with the
if-Not column shifted down $0.25; a bandwagon-H vote on a note that flips
unhelpful loses up to $0.21.

### C — "Pure log rule" — `base_U = $1.00, no clip`

worst −$0.60 · best $3.60 · avg $1.73/vote. Textbook proper scoring rule; a
Not-helpful vote against a 0.85 consensus that turns out wrong earns only
+$0.17 (vs +$1.04 clipped), and wrong bandwagoning reaches −$0.60.

Variant for any preset: `w_S = 0` makes Somewhat pure abstention — it moves
nothing and always pays exactly `base_H / base_U` ($2.00/$1.00). Bigger H-vs-S
gap ($0.96), but Somewhat becomes a riskless click.

## Properties (preset A)

- Voting with your honest belief maximizes expected donation (proper rule; the
  clip bends this only at extremes).
- Early correct votes beat late pile-on votes by ~$1.10 (the information
  premium): H on a fresh note +$3.00 vs H on a 0.85-consensus note +$2.20.
- Correcting a wrong consensus pays best of all: U at p=0.85 that settles
  Not-Helpful earns +$2.70.
- 10 unanimous H votes take p from 0.35 to 0.97 — no explosion.

## Variant menu (added after review)

Clarification from Jim: a voter whose settled total would be negative simply
donates $0 (floor at fulfilment) — so negative displayed numbers are fine and
the never-negative constraint is a taste choice, not a hard requirement.

### S1 — "Perfect mirror" (pay the same for helpful and unhelpful notes)

`p0 = 0.5, w_H = w_U = 0.35, w_S = 0, b = 5, base = $1.75/$1.75, no clip`
worst **$0.00 exactly** (no clip needed: 1.75 − 5·0.35 = 0) · best $3.50 · avg $1.99/vote (~$16/note)

| context | Helpful | Somewhat | Not helpful |
|---|---|---|---|
| fresh note (p=0.50) | +2.55 / +0.80 | +1.75 / +1.75 | +0.80 / +2.55 |
| consensus-unhelpful (p=0.15) | +3.20 / +1.45 | +1.75 / +1.75 | +0.25 / +2.00 |
| consensus-helpful (p=0.85) | +2.00 / +0.25 | +1.75 / +1.75 | +1.45 / +3.20 |

The table is an exact mirror (H at p and U at 1−p swap). Pure log rule,
textbook-proper, and the cost matches the current $2/vote scheme.

### S2 — Equal bases, helpful-tilted prior

`p0 = 0.35, w_H = 0.4, w_S = 0, w_U = 0.52, b = 5, base = $1.50/$1.50, clip = 0.24`
worst $0.30 · best $4.10 · avg $1.80/vote

| context | Helpful | Somewhat | Not helpful |
|---|---|---|---|
| fresh note (p=0.35) | +2.70 / +0.70 | +1.50 / +1.50 | +0.30 / +2.25 |
| consensus-unhelpful (p=0.15) | +3.15 / +1.15 | +1.50 / +1.50 | +0.30 / +1.80 |
| consensus-helpful (p=0.85) | +1.75 / +0.30 | +1.50 / +1.50 | +1.00 / +3.60 |

Even with equal bases, a correct Helpful vote on a fresh note out-pays a
correct Not-helpful vote by $0.44 — at a 35% prior, "helpful" is the bolder
claim so it carries more information. The premium emerges from the math, not
from unequal pay.

### S3 — Equal bases $2.00, zero-floor pure rule

`p0 = 0.35, w_H = w_U = 0.4, w_S = 0, b = 5, base = $2.00/$2.00, no clip`
worst $0.00 · best $4.00 · avg $2.28/vote (~$18/note). Like S1 but at the
35% prior and $2 base — the most generous variant.

### Summary of all variants

| variant | bases H/U | worst | best | avg/vote | gap H-S | gap U-S | helpful-premium |
|---|---|---|---|---|---|---|---|
| A never-negative (asym) | 2.00/1.00 | +0.04 | 3.60 | 1.75 | 0.66 | 0.79 | 1.35 |
| B mild sting (asym) | 2.00/0.75 | −0.21 | 3.60 | 1.62 | 0.66 | 0.79 | 1.60 |
| C pure log (asym) | 2.00/1.00 | −0.60 | 3.60 | 1.73 | 0.66 | 0.79 | 1.35 |
| D cheap (asym) | 2.00/0.25 | −0.71 | 3.60 | 1.37 | 0.96 | 0.61 | 2.10 |
| S1 perfect mirror | 1.75/1.75 | 0.00 | 3.50 | 1.99 | 0.80 | 0.80 | 0.00 |
| S2 equal bases, 35% prior | 1.50/1.50 | +0.30 | 4.10 | 1.80 | 1.21 | 0.77 | 0.44 |
| S3 equal bases $2, pure | 2.00/2.00 | 0.00 | 4.00 | 2.28 | 1.21 | 0.61 | 0.59 |

(A–C use w_S = 0.12; D and S1–S3 use w_S = 0, where Somewhat is a riskless
flat-base click.)

## Open decisions / caveats

- **Settlement**: needs a defined lock-in event (e.g. status at T=30 days or
  the feed's locked-in transition). Never-settles → no donation (or flat $1).
- **Negative donations can't be executed literally** — charity money can't be
  clawed back. B/C's negatives only work as netting against the voter's running
  total (floored at 0 lifetime). A avoids the problem entirely.
- **Every vote now mints money** (the base), no reasoning required → rate-limit
  votes per user per day; author self-votes excluded from both L and donations.
- Naive independent updating overcounts correlated votes; small `w` is the
  mitigation (deliberate, per design).
- The reasoning box no longer gates the donation — keep it as the optional
  comment path.
