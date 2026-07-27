"""How does a vote's donation shrink as votes pile up?

The live formula (preset S2 x 0.8) pays base + b * (log score of the vote).
The score term decays as the note's probability saturates, but the flat base
does not -- so the 6th unanimous Helpful vote still mints ~$1.47. This script
compares belief models whose *information genuinely runs out*, so the decay
falls out of the model instead of being imposed.

Run: uv run --with scipy src/scripts_jim/2026_07_21_donation_decay/decay.py
"""

from dataclasses import dataclass
from itertools import combinations
from math import exp, log
from typing import Callable, Protocol

from scipy.optimize import brentq
from scipy.special import betainc

HELPFUL, SOMEWHAT, NOT_HELPFUL = 1, 0, -1
VOTES = (HELPFUL, SOMEWHAT, NOT_HELPFUL)
VOTE_LABEL = {HELPFUL: "Helpful", SOMEWHAT: "Somewhat", NOT_HELPFUL: "Not helpful"}

IF_HELPFUL, IF_NOT_HELPFUL = 0, 1  # index into a (score-if-H, score-if-U) pair
VOTES_SHOWN = 10


def logit(p: float) -> float:
    return log(p / (1 - p))


def sigmoid(x: float) -> float:
    return 1 / (1 + exp(-x))


# --------------------------------------------------------------------------
# Belief models: a tally of prior votes -> P(note settles rated Helpful)
# --------------------------------------------------------------------------


@dataclass
class Tally:
    helpful: int = 0
    somewhat: int = 0
    not_helpful: int = 0

    def plus(self, vote: int) -> "Tally":
        return Tally(
            self.helpful + (vote == HELPFUL),
            self.somewhat + (vote == SOMEWHAT),
            self.not_helpful + (vote == NOT_HELPFUL),
        )


class BeliefModel(Protocol):
    def p(self, tally: Tally) -> float:
        """P(the note settles rated Helpful) given the votes cast so far."""


@dataclass
class Independent:
    """Live model: every vote is fresh evidence, log-odds move by a fixed step."""

    p0: float = 0.35
    w_h: float = 0.40
    w_s: float = 0.0
    w_u: float = 0.52

    def p(self, tally: Tally) -> float:
        return sigmoid(
            logit(self.p0)
            + self.w_h * tally.helpful
            + self.w_s * tally.somewhat
            - self.w_u * tally.not_helpful
        )


@dataclass
class Redundant:
    """Correlated voters: the k-th person to agree is partly echoing the first,
    so its evidence is discounted by rho**k. Total movement is bounded by
    w / (1 - rho), i.e. the crowd can only ever tell us so much."""

    p0: float = 0.35
    w_h: float = 0.95
    w_u: float = 1.15
    rho: float = 0.55

    def _discounted_total(self, w: float, n: int) -> float:
        return w * (1 - self.rho**n) / (1 - self.rho)

    def p(self, tally: Tally) -> float:
        return sigmoid(
            logit(self.p0)
            + self._discounted_total(self.w_h, tally.helpful)
            - self._discounted_total(self.w_u, tally.not_helpful)
        )


@dataclass
class LatentQuality:
    """Fully Bayesian: the note has a latent quality theta = the share of raters
    who would call it helpful. Votes are iid Bernoulli(theta) draws; the note
    settles Helpful iff theta > threshold. Once theta is pinned down the
    remaining uncertainty is irreducible, so the information runs out on its
    own -- no decay knob anywhere."""

    a0: float = 1.6
    b0: float = 1.6
    p0: float = 0.35
    #: What one Somewhat vote adds to each side of the Beta. (0.5, 0.5) reads it
    #: as one rater scoring the note 0.5 on X's own 1.0/0.5/0.0 scale; (0.5, 0.0)
    #: reads it as half a Helpful vote and half a non-observation.
    somewhat_update: tuple[float, float] = (0.5, 0.5)
    #: Solved from p0 unless pinned (e.g. to X's CRH intercept threshold of 0.40).
    threshold: float | None = None

    def __post_init__(self) -> None:
        if self.threshold is None:
            self.threshold = brentq(
                lambda t: (1 - betainc(self.a0, self.b0, t)) - self.p0, 1e-6, 1 - 1e-6
            )

    def p(self, tally: Tally) -> float:
        to_a, to_b = self.somewhat_update
        a = self.a0 + tally.helpful + to_a * tally.somewhat
        b = self.b0 + tally.not_helpful + to_b * tally.somewhat
        return float(1 - betainc(a, b, self.threshold))


# --------------------------------------------------------------------------
# Payout: base + b * clipped score change, evaluated against both outcomes
# --------------------------------------------------------------------------

ScoringRule = Callable[[float], tuple[float, float]]


def log_scores(p: float) -> tuple[float, float]:
    """(score if the note settles Helpful, score if it settles Not helpful)."""
    return log(p), log(1 - p)


def brier_scores(p: float) -> tuple[float, float]:
    """Quadratic rule. Also proper, but *bounded*: as the crowd converges and
    p stops moving, the payout goes to zero on BOTH sides -- a late vote is a
    low-stakes click, not a big bet at long odds."""
    return 1 - (1 - p) ** 2, 1 - p**2


@dataclass
class Scheme:
    name: str
    model: BeliefModel
    b: float
    base: float = 0.0
    clip: float | None = None
    rule: ScoringRule = log_scores
    scale: float = 1.0

    def _score_term(self, change: float) -> float:
        return self.b * (change if self.clip is None else max(change, -self.clip))

    def _base(self, tally: Tally) -> float:
        return self.base

    def pair(self, tally: Tally, vote: int) -> tuple[float, float]:
        """(donated if the note settles Helpful, donated if it settles Not helpful)."""
        before = self.rule(self.model.p(tally))
        after = self.rule(self.model.p(tally.plus(vote)))
        base = self._base(tally)
        return tuple(  # type: ignore[return-value]
            round(self.scale * (base + self._score_term(after[o] - before[o])), 2)
            for o in (IF_HELPFUL, IF_NOT_HELPFUL)
        )


@dataclass
class StakeScheme(Scheme):
    """The base is the *stake still on the table*: exactly the worst score drop
    any vote could suffer from here, so the smallest number on the card is $0
    (plus a flat tip) and the whole scale shrinks as the crowd converges.

    Still incentive-compatible: the base depends on the tally you walked into,
    never on which way you vote."""

    tip: float = 0.25

    def _base(self, tally: Tally) -> float:
        before = self.rule(self.model.p(tally))
        worst_drop = max(
            before[o] - self.rule(self.model.p(tally.plus(v)))[o] for v in VOTES for o in (IF_HELPFUL, IF_NOT_HELPFUL)
        )
        return self.tip + self.b * max(worst_drop, 0.0)


SCHEMES = [
    # w_s = 0 mirrors LOG_ODDS_PER_VOTE in donationScoring.ts: Somewhat moves nothing.
    Scheme("Live (S2 x0.8)", Independent(), b=5.0, base=1.5, clip=0.24, scale=0.8),
    Scheme("A: drop the base", Independent(), b=9.0, base=0.0, clip=0.22),
    Scheme("B: redundant voters", Redundant(), b=6.2, base=0.0, clip=0.22),
    Scheme("C: latent quality", LatentQuality(), b=8.5, base=0.0, clip=0.22),
    Scheme("D: latent + Brier", LatentQuality(), b=11.5, base=0.25, rule=brier_scores),
    StakeScheme("F: shrinking stake", LatentQuality(), b=5.0, rule=brier_scores),
]


@dataclass
class Row:
    """One vote in a unanimous run. Both outcomes are named outright: a
    "right/wrong" framing is undefined for a Somewhat vote, which is neither."""

    p_before: float
    if_helpful: float
    if_not_helpful: float


def unanimous_run(scheme: Scheme, vote: int) -> list[Row]:
    """VOTES_SHOWN identical votes cast one after another on a fresh note."""
    rows, tally = [], Tally()
    for _ in range(VOTES_SHOWN):
        if_helpful, if_not_helpful = scheme.pair(tally, vote)
        rows.append(Row(scheme.model.p(tally), if_helpful, if_not_helpful))
        tally = tally.plus(vote)
    return rows


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------


Outcome = Callable[[Row], float]


def print_scheme_comparison(
    title: str, vote: int, amount: Outcome, width: int = 22, show_p: bool = True
) -> None:
    """One column group per scheme, one row per vote in a unanimous run.
    `amount` names which side of the pair the column shows."""
    print(f"\n===== {title} =====")
    header = "vote |" + "".join(f" {s.name:>{width}} |" for s in SCHEMES)
    print(header)
    print("-" * len(header))
    runs = [unanimous_run(s, vote) for s in SCHEMES]
    for i in range(VOTES_SHOWN):
        cells = (
            f"p={run[i].p_before:.2f}  ${amount(run[i]):>5.2f}" if show_p else f"${amount(run[i]):.2f}"
            for run in runs
        )
        print(f"{i + 1:>4} |" + "".join(f" {c:>{width}} |" for c in cells))
    print(" sum |" + "".join(f" {sum(amount(r) for r in run):>{width}.2f} |" for run in runs))


def print_tuning_grid() -> None:
    print("\n===== Tuning the shrinking-stake scheme: b and prior strength =====")
    print(" " * 11 + "|" + "".join(f" vote{i:>2} |" for i in range(1, VOTES_SHOWN + 1)) + "  sum |")
    for prior_strength in (1.6, 2.5, 4.0):
        for b in (5.0, 6.0, 7.0):
            model = LatentQuality(a0=prior_strength, b0=prior_strength)
            run = unanimous_run(StakeScheme("", model, b=b, rule=brier_scores), HELPFUL)
            cells = "".join(f" {'$%.2f' % r.if_helpful:>6} |" for r in run)
            print(f"a={prior_strength} b={b} |{cells} {sum(r.if_helpful for r in run):>5.2f} |")


@dataclass
class Band:
    """The span of private beliefs q over which one vote pays best."""

    vote: int
    q_from: float
    q_to: float

    @property
    def width(self) -> float:
        return self.q_to - self.q_from


def optimal_bands(pairs: dict[int, tuple[float, float]]) -> list[Band]:
    """Which vote maximizes expected donation, as a function of your private
    belief q that the note settles Helpful.

    This is the real test of a middle option: honest reporting is only
    meaningful if Somewhat wins over a non-degenerate band of beliefs.

    Expected donation is linear in q, so the answer is the upper envelope of
    three lines -- solved exactly at their intersections rather than sampled,
    since the headline finding is a band only ~0.01 wide."""
    intercept_slope = {
        v: (pairs[v][IF_NOT_HELPFUL], pairs[v][IF_HELPFUL] - pairs[v][IF_NOT_HELPFUL]) for v in VOTES
    }
    expected = lambda v, q: intercept_slope[v][0] + q * intercept_slope[v][1]

    cuts = {0.0, 1.0}
    for v, w in combinations(VOTES, 2):
        (c_v, m_v), (c_w, m_w) = intercept_slope[v], intercept_slope[w]
        if m_v != m_w:
            crossing = (c_w - c_v) / (m_v - m_w)
            if 0.0 < crossing < 1.0:
                cuts.add(crossing)

    bands: list[Band] = []
    ordered = sorted(cuts)
    for lo, hi in zip(ordered, ordered[1:]):
        best = max(VOTES, key=lambda v: expected(v, (lo + hi) / 2))
        if bands and bands[-1].vote == best:
            bands[-1].q_to = hi
        else:
            bands.append(Band(best, lo, hi))
    return bands


def print_bands(title: str, tally: Tally) -> None:
    print(f"\n===== Which vote pays best, by your private belief q -- {title} =====")
    for scheme in SCHEMES:
        pairs = {v: scheme.pair(tally, v) for v in VOTES}
        spans = " ".join(
            f"{VOTE_LABEL[b.vote]}:[{b.q_from:.3f},{b.q_to:.3f}]" for b in optimal_bands(pairs)
        )
        somewhat_width = sum(b.width for b in optimal_bands(pairs) if b.vote == SOMEWHAT)
        print(
            f"  {scheme.name:>22}: {spans:<64} "
            f"Somewhat ${pairs[SOMEWHAT][IF_HELPFUL]:.2f}/${pairs[SOMEWHAT][IF_NOT_HELPFUL]:.2f} "
            f"band {somewhat_width:.3f}"
        )


#: X's CRH bar, on the same 1.0 / 0.5 / 0.0 rating scale the Beta update uses.
#: Approximation: 0.40 thresholds the matrix-factorization note intercept, not a
#: raw mean rating, so reading it as a bar on theta is a modelling liberty -- but
#: it is a real constant rather than one fitted to our own base rate.
CN_CRH_THRESHOLD = 0.40

#: Total prior weight for the pinned-threshold model, from the sweep below.
RECOMMENDED_PRIOR_STRENGTH = 5.0
#: Dollars per unit of Brier score, as shipped. Raised 5 -> 6.25 (Jim,
#: 2026-07-21) to lift every amount 25% -- the tip is additive, so scaling this
#: alone leaves the $0.25 floor untouched.
SHIPPED_DOLLARS_PER_SCORE_UNIT = 6.25


def shipped_scheme() -> "StakeScheme":
    return StakeScheme(
        "shipped",
        cn_calibrated_prior(
            RECOMMENDED_PRIOR_STRENGTH, CN_CRH_THRESHOLD, 0.35, SHIPPED_SOMEWHAT_UPDATE
        ),
        b=SHIPPED_DOLLARS_PER_SCORE_UNIT,
        rule=brier_scores,
    )


def print_shipped_schedule() -> None:
    """What a voter donates, and what a note costs in total, as unanimous
    Helpful votes accumulate. This is the shipped configuration."""
    print("\n===== SHIPPED: donation per Helpful vote, and running total =====")
    print(" vote | p before |  if helpful |  cumulative | if NOT helpful")
    running = 0.0
    for i, row in enumerate(unanimous_run(shipped_scheme(), HELPFUL), start=1):
        running += row.if_helpful
        print(
            f" {i:>4} |    {row.p_before:.3f} |      ${row.if_helpful:>5.2f} |"
            f"      ${running:>6.2f} |         ${row.if_not_helpful:.2f}"
        )


#: What one Somewhat vote adds to (a, b), as shipped. Jim, 2026-07-21: half a
#: Helpful vote and nothing on the other side, so Somewhat can only ever help a
#: note. Consequence accepted deliberately -- enough Somewhat votes alone will
#: rate a note helpful (5 of them, at the shipped thresholds).
SHIPPED_SOMEWHAT_UPDATE = (0.5, 0.0)


def cn_calibrated_prior(
    strength: float, threshold: float, p0: float, somewhat_update: tuple[float, float] = (0.5, 0.5)
) -> LatentQuality:
    """Pin the threshold and let an asymmetric prior of the given total weight
    carry the base rate, instead of solving the threshold from a symmetric prior."""
    mean = brentq(
        lambda mu: (1 - betainc(strength * mu, strength * (1 - mu), threshold)) - p0, 1e-4, 1 - 1e-4
    )
    return LatentQuality(
        a0=strength * mean,
        b0=strength * (1 - mean),
        threshold=threshold,
        somewhat_update=somewhat_update,
    )


def print_somewhat_variants() -> None:
    """Does a Somewhat vote push p up or down, and is the model coherent?"""
    variants = {
        "0.5/0.5, t solved (0.615)": LatentQuality(),
        "0.5/0.0, t solved (0.615)": LatentQuality(somewhat_update=(0.5, 0.0)),
        f"0.5/0.5, t pinned ({CN_CRH_THRESHOLD})": cn_calibrated_prior(
            RECOMMENDED_PRIOR_STRENGTH, CN_CRH_THRESHOLD, 0.35
        ),
        f"0.5/0.0, t pinned ({CN_CRH_THRESHOLD}) SHIPPED": shipped_scheme().model,
    }
    print("\n===== Somewhat vote: four readings (update rule x where the bar sits) =====")
    print(f"{'variant':>33} | " + " ".join(f"{n:>5}S" for n in range(0, 11, 2)) + " |    2H  2H+1S     3H")
    for name, model in variants.items():
        run = " ".join(f"{model.p(Tally(somewhat=n)):>6.2f}" for n in range(0, 11, 2))
        near = (Tally(helpful=2), Tally(helpful=2, somewhat=1), Tally(helpful=3))
        print(f"  {name:>31} | {run} | " + " ".join(f"{model.p(t):>6.3f}" for t in near))
    print("  0.5/0.0 asserts theta ~ 0.80 after 10 raters, none of whom said Helpful --")
    print("  Jim's call (2026-07-21): that is the intended reading, not a bug.")


def print_prior_strength_sweep() -> None:
    """With the threshold pinned to X's bar, prior strength trades early vs late."""
    print(f"\n===== Threshold pinned at {CN_CRH_THRESHOLD}: prior strength sweep (b=5) =====")
    for strength in (3.2, 5.0, 7.0, 9.0):
        model = cn_calibrated_prior(strength, CN_CRH_THRESHOLD, 0.35)
        scheme = StakeScheme("", model, b=5.0, rule=brier_scores)
        run = unanimous_run(scheme, HELPFUL)
        band = sum(b.width for b in optimal_bands({v: scheme.pair(Tally(), v) for v in VOTES}) if b.vote == SOMEWHAT)
        amounts = " ".join(f"{r.if_helpful:>5.2f}" for r in run[:7])
        print(
            f"  Beta({model.a0:.2f},{model.b0:.2f}) | {amounts} | "
            f"sum {sum(r.if_helpful for r in run):>5.2f} | Somewhat band {band:.3f}"
        )


def print_state(title: str, tally: Tally, vote: int) -> None:
    print(f"\n===== {title} =====")
    for scheme in SCHEMES:
        if_helpful, if_not = scheme.pair(tally, vote)
        p = scheme.model.p(tally)
        print(f"  {scheme.name:>22}: p={p:.2f}  ${if_helpful:.2f} if helpful / ${if_not:.2f} if not")


def main() -> None:
    print_scheme_comparison(
        "Helpful votes, one after another (amount if the note settles Helpful)",
        HELPFUL,
        lambda r: r.if_helpful,
    )
    print_scheme_comparison(
        "Not-helpful votes, one after another (amount if the note settles Not helpful)",
        NOT_HELPFUL,
        lambda r: r.if_not_helpful,
    )
    print_scheme_comparison(
        "The other side of the pair (Helpful votes, amount if it settles NOT helpful)",
        HELPFUL,
        lambda r: r.if_not_helpful,
        width=18,
        show_p=False,
    )
    print_tuning_grid()
    for outcome, amount in (
        ("Helpful", lambda r: r.if_helpful),
        ("Not helpful", lambda r: r.if_not_helpful),
    ):
        print_scheme_comparison(
            f"Somewhat votes, one after another (amount if the note settles {outcome})",
            SOMEWHAT,
            amount,
        )
    print_shipped_schedule()
    print_somewhat_variants()
    print_prior_strength_sweep()
    print_bands("fresh note", Tally())
    print_bands("5 Helpful already", Tally(helpful=5))
    print_bands("3 Helpful + 2 Not helpful", Tally(helpful=3, not_helpful=2))
    print_state("Contrarian: 5 Helpful already, you vote Not helpful", Tally(helpful=5), NOT_HELPFUL)
    print_state(
        "Split house: 3 Helpful + 2 Not helpful, you vote Helpful", Tally(helpful=3, not_helpful=2), HELPFUL
    )


if __name__ == "__main__":
    main()
