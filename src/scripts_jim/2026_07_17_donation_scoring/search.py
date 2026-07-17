#!/usr/bin/env python3
"""Grid-search donation-formula parameters for Common Notes vote donations.

Mechanism (per note, per vote — fully independent):
  - Note carries running log-odds L of eventually settling Helpful; prior L0 = logit(p0).
  - A vote moves L by a fixed delta: Helpful +w_H, Somewhat +w_S, Not-helpful -w_U.
  - The vote's donation pair, shown at vote time and frozen:
      D_helpful   = base_H + b * max(ln p_new     - ln p_old,     -clip_at)
      D_unhelpful = base_U + b * max(ln(1-p_new)  - ln(1-p_old),  -clip_at)
    base_* depend only on the outcome (not the vote) so they add no incentive
    distortion; the b-term is the log market scoring rule (pay = information
    contributed toward the realized outcome); clip_at caps the scary downside.

Run from repo root:  python3 src/scripts_jim/2026_07_17_donation_scoring/search.py
"""

import itertools
import math
import random
from dataclasses import dataclass

# ---------------- mechanism ----------------

def softplus(x: float) -> float:
    return math.log1p(math.exp(-abs(x))) + max(x, 0.0)

def logistic(L: float) -> float:
    return 1.0 / (1.0 + math.exp(-L))

def logit(p: float) -> float:
    return math.log(p / (1.0 - p))

@dataclass(frozen=True)
class Params:
    p0: float       # prior P(note settles Helpful)
    w_H: float      # log-odds moved by a Helpful vote
    w_S: float      # log-odds moved by a Somewhat-helpful vote
    w_U: float      # log-odds moved (downward) by a Not-helpful vote
    b: float        # $ per nat of log-score improvement
    base_H: float   # vote-independent $ if the note settles Helpful
    base_U: float   # vote-independent $ if the note settles Not Helpful
    clip_at: float  # floor on the score delta (math.inf = pure log rule)

    def delta(self, vote: str) -> float:
        return {"H": self.w_H, "S": self.w_S, "U": -self.w_U}[vote]

def donation(P: Params, L0: float, vote: str) -> tuple[float, float]:
    """($ if settles Helpful, $ if settles Not Helpful) for a vote cast at log-odds L0."""
    L1 = L0 + P.delta(vote)
    dS_helpful = softplus(-L0) - softplus(-L1)    # ln p1 - ln p0
    dS_unhelpful = softplus(L0) - softplus(L1)    # ln(1-p1) - ln(1-p0)
    return (P.base_H + P.b * max(dS_helpful, -P.clip_at),
            P.base_U + P.b * max(dS_unhelpful, -P.clip_at))

def analytic_extremes(P: Params) -> tuple[float, float]:
    """Worst/best possible donation over all vote types and any L (asymptotic bounds)."""
    worst = min(P.base_U - P.b * min(P.w_H, P.clip_at),   # bandwagon H vote, note flips unhelpful
                P.base_U - P.b * min(P.w_S, P.clip_at),
                P.base_H - P.b * min(P.w_U, P.clip_at))   # bandwagon U vote, note flips helpful
    best = max(P.base_H + P.b * P.w_H, P.base_U + P.b * P.w_U)
    return worst, best

# ---------------- evaluation ----------------

MAX_DONATION_CAP = 5.0
GAP_MIN = 0.45            # H-vs-S payout gap (and U-vs-S) must be at least this, at the prior
PREMIUM_MIN = 0.20        # correct-H on a helpful note must beat correct-U on an unhelpful note
COST_RANGE = (1.2, 2.8)   # average $ per vote (current flat scheme is $2)
SAT_P10_MAX = 0.98        # 10 unanimous H votes must not push p past this
SAT_P5_MIN = 0.60         # ...but 5 unanimous H votes must at least reach this (votes matter)
VOTES_PER_NOTE = 8
N_SEQUENCES = 60
VOTE_MIX = {"helpful": (("H", 0.60), ("S", 0.25), ("U", 0.15)),
            "unhelpful": (("H", 0.15), ("S", 0.25), ("U", 0.60))}
CONTEXT_PS = (0.15, None, 0.85)  # None = the prior p0

FLOORS = (("never-negative", 0.0), ("mild (>=-$0.50)", -0.5), ("sharp (>=-$1.00)", -1.0))

def generate_sequences(rng: random.Random) -> dict[str, list[list[str]]]:
    seqs = {}
    for outcome, mix in VOTE_MIX.items():
        votes, weights = zip(*mix)
        seqs[outcome] = [rng.choices(votes, weights=weights, k=VOTES_PER_NOTE)
                         for _ in range(N_SEQUENCES)]
    return seqs

def average_cost_per_vote(P: Params, seqs: dict[str, list[list[str]]]) -> float:
    total, n = 0.0, 0
    for outcome, sequences in seqs.items():
        pay_index = 0 if outcome == "helpful" else 1
        for seq in sequences:
            L = logit(P.p0)
            for vote in seq:
                total += donation(P, L, vote)[pay_index]
                n += 1
                L += P.delta(vote)
    return total / n

@dataclass
class Evaluation:
    P: Params
    worst: float
    best: float
    gap_H: float       # X(H) - X(S) at prior, helpful outcome
    gap_U: float       # Y(U) - Y(S) at prior, unhelpful outcome
    premium: float     # X(H) - Y(U) at prior
    spread: float      # X(H) early-contrarian vs late-bandwagon
    cost: float
    score: float

def evaluate(P: Params, seqs) -> Evaluation | None:
    worst, best = analytic_extremes(P)
    if best > MAX_DONATION_CAP:
        return None
    p5 = logistic(logit(P.p0) + 5 * P.w_H)
    p10 = logistic(logit(P.p0) + 10 * P.w_H)
    if p10 > SAT_P10_MAX or p5 < SAT_P5_MIN:
        return None

    L_prior = logit(P.p0)
    X_H, Y_H = donation(P, L_prior, "H")
    X_S, Y_S = donation(P, L_prior, "S")
    X_U, Y_U = donation(P, L_prior, "U")
    gap_H = X_H - X_S
    gap_U = Y_U - Y_S
    premium = X_H - Y_U
    if gap_H < GAP_MIN or gap_U < GAP_MIN or premium < PREMIUM_MIN:
        return None
    spread = donation(P, logit(0.15), "H")[0] - donation(P, logit(0.85), "H")[0]

    cost = average_cost_per_vote(P, seqs)
    if not (COST_RANGE[0] <= cost <= COST_RANGE[1]):
        return None

    score = (min(gap_H, 1.2) + min(gap_U, 1.2)
             + 0.5 * min(premium, 0.8)
             + 0.4 * min(spread, 1.2)
             - 1.0 * abs(cost - 2.0)
             - 0.5 * max(0.0, -worst))
    return Evaluation(P, worst, best, gap_H, gap_U, premium, spread, cost, score)

# ---------------- reporting ----------------

def describe(ev: Evaluation) -> str:
    P = ev.P
    clip_str = "none (pure log rule)" if math.isinf(P.clip_at) else f"{P.clip_at:.2f}"
    lines = [
        f"p0={P.p0}  w_H={P.w_H}  w_S={P.w_S:.2f}  w_U={P.w_U:.2f}  "
        f"b={P.b}  base_H=${P.base_H:.2f}  base_U=${P.base_U:.2f}  clip={clip_str}",
        f"  score={ev.score:.2f}  worst=${ev.worst:.2f}  best=${ev.best:.2f}  "
        f"cost/vote=${ev.cost:.2f} (~${ev.cost * VOTES_PER_NOTE:.0f}/note)",
        f"  gaps at prior: H-vs-S=${ev.gap_H:.2f}  U-vs-S=${ev.gap_U:.2f}  "
        f"helpful-premium=${ev.premium:.2f}  early-vs-late spread=${ev.spread:.2f}",
    ]
    sat = [f"{logistic(logit(P.p0) + k * P.w_H):.2f}" for k in (1, 2, 3, 5, 8, 10)]
    lines.append(f"  p after 1,2,3,5,8,10 unanimous H votes: {', '.join(sat)}")
    for ctx_p in CONTEXT_PS:
        p = P.p0 if ctx_p is None else ctx_p
        label = "fresh note (prior)" if ctx_p is None else f"consensus at p={p}"
        L = logit(p)
        row = "  ".join(
            f"{v}: {donation(P, L, v)[0]:+.2f}/{donation(P, L, v)[1]:+.2f}"
            for v in ("H", "S", "U"))
        lines.append(f"  {label:<24} {row}   (if-Helpful / if-Not, $)")
    return "\n".join(lines)

def main() -> None:
    seqs = generate_sequences(random.Random(7))
    grid = itertools.product(
        (0.35, 0.5),                       # p0
        (0.25, 0.3, 0.35, 0.4, 0.5),       # w_H
        (0.0, 0.3, 0.5),                   # w_S as fraction of w_H
        (1.0, 1.3),                        # w_U as fraction of w_H
        (1.5, 2.0, 2.5, 3.0, 4.0),         # b
        (0.75, 1.0, 1.25, 1.5, 2.0),       # base_H
        (0.0, 0.25, 0.5, 0.75, 1.0),       # base_U
        (math.inf, 0.6),                   # clip as fraction of w_H (inf = none)
    )
    by_floor: dict[str, list[Evaluation]] = {name: [] for name, _ in FLOORS}
    n_total = n_passed = 0
    for p0, w_H, s_frac, u_frac, b, base_H, base_U, clip_frac in grid:
        n_total += 1
        if base_H <= base_U:
            continue
        clip_at = math.inf if math.isinf(clip_frac) else clip_frac * w_H
        P = Params(p0, w_H, round(s_frac * w_H, 3), round(u_frac * w_H, 3),
                   b, base_H, base_U, clip_at)
        ev = evaluate(P, seqs)
        if ev is None:
            continue
        n_passed += 1
        for name, floor in FLOORS:  # assign to the tightest floor it satisfies
            if ev.worst >= floor - 1e-9:
                by_floor[name].append(ev)
                break

    print(f"grid: {n_total} combos, {n_passed} passed all constraints\n")
    for name, _ in FLOORS:
        candidates = sorted(by_floor[name], key=lambda e: -e.score)
        print(f"=== {name}  ({len(candidates)} candidates) ===")
        shown, seen_shapes = 0, set()
        for ev in candidates:
            shape = (ev.P.w_H, ev.P.b, math.isinf(ev.P.clip_at))
            if shape in seen_shapes:
                continue
            seen_shapes.add(shape)
            print(describe(ev) + "\n")
            shown += 1
            if shown == 4:
                break
        print()

if __name__ == "__main__":
    main()
