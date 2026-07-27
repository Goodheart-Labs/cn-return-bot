"""
Rob's velocity stats, recomputed head-to-head for velocity vs. our P(helpful).
Outcome = the note reached CURRENTLY_RATED_HELPFUL.

Two framings from the velocity proposal, each computed for BOTH scores:

  1. Quintile table — split submitted notes into fifths by the score; per fifth
     report the share that reached Helpful. (Rob: slowest fifth 6%, fastest 16%.)
  2. Floor replay — a floor at the p-th percentile keeps the top (100−p)% of
     notes; report what share of every eventual-Helpful note that floor retains,
     plus the floor's threshold in the score's native units.
     (Rob: p10 keeps 96% of Helpful, p20 keeps 90%.)

CAVEAT: within-submitted retrospective on notes with complete tweet data (n =
3,711), a subset of Rob's 9-month all-notes population, so the velocity figures
won't match his to the decimal — but both scores are measured on the SAME pool,
so the head-to-head is fair.
"""
import matplotlib.pyplot as plt
import numpy as np

import ratings_model as rm
from fit_views import load_sample, make_saturating_family, saturating_probability

QUINTILES = 5
FLOOR_PERCENTILES = (10, 20, 50)
VELOCITY_COLOR, PROBABILITY_COLOR = "#eb6834", "#184f95"


def quintile_chunks(score: np.ndarray) -> list[np.ndarray]:
    return np.array_split(np.argsort(score), QUINTILES)


def print_quintile_table(velocity, probability, helpful) -> None:
    print("\nHelpful rate by score quintile (fifth 1 = slowest / lowest P)")
    print(f"  {'fifth':<9} {'velocity range (/h)':>24} {'Helpful':>8}   {'P(helpful) range':>18} {'Helpful':>8}")
    for q, (v_chunk, p_chunk) in enumerate(zip(quintile_chunks(velocity), quintile_chunks(probability)), 1):
        v_span = f"{velocity[v_chunk].min():,.0f} – {velocity[v_chunk].max():,.0f}"
        p_span = f"{probability[p_chunk].min():.1%} – {probability[p_chunk].max():.1%}"
        print(f"  {q:<9} {v_span:>24} {helpful[v_chunk].mean():>8.1%}   {p_span:>18} {helpful[p_chunk].mean():>8.1%}")


def print_floor_replay(velocity, probability, helpful) -> None:
    print("\nfloor replay — Helpful notes retained above each percentile floor (keep = 100 − p)")
    print(f"  {'floor':<7} {'keep':>5}   {'velocity threshold':>19} {'Helpful kept':>13}   "
          f"{'P threshold':>12} {'Helpful kept':>13}")
    for percentile in FLOOR_PERCENTILES:
        cells = []
        for score in (velocity, probability):
            threshold = np.percentile(score, percentile)
            cells.append((threshold, helpful[score >= threshold].sum() / helpful.sum()))
        (v_thr, v_kept), (p_thr, p_kept) = cells
        print(f"  p{percentile:<6} {1 - percentile / 100:>5.0%}   {f'{v_thr:,.0f}/h':>19} {v_kept:>13.1%}   "
              f"{f'{p_thr:.1%}':>12} {p_kept:>13.1%}")


def plot(velocity, probability, helpful) -> None:
    fifths = np.arange(1, QUINTILES + 1)
    width = 0.4
    fig, ax = plt.subplots(figsize=(8.5, 5.2), facecolor="white")
    for offset, score, color, label in [(-width / 2 - 0.01, velocity, VELOCITY_COLOR, "velocity"),
                                        (width / 2 + 0.01, probability, PROBABILITY_COLOR, "P(helpful)")]:
        rates = [helpful[chunk].mean() for chunk in quintile_chunks(score)]
        ax.bar(fifths + offset, rates, width, color=color, edgecolor="white", linewidth=1.5, label=label)
    ax.set_xticks(fifths)
    ax.set_xticklabels(["1\nslowest", "2", "3", "4", "5\ntop"])
    ax.yaxis.set_major_formatter(plt.matplotlib.ticker.PercentFormatter(xmax=1))
    ax.set_xlabel("Score quintile", color=rm.INK_MUTED, fontsize=9)
    rm.style_axes(ax, "Reached Helpful, by score quintile",
                  "share of each fifth that ended CURRENTLY_RATED_HELPFUL")
    ax.legend(frameon=False, fontsize=8.5, labelcolor=rm.INK_MUTED, loc="upper left")
    fig.tight_layout()
    fig.savefig(rm.HERE / "velocity_stats.png", dpi=160, facecolor="white")
    print("\nwrote velocity_stats.png")


def main() -> None:
    pool = load_sample(exclude_not_helpful=False)
    velocity = np.array([s["velocity"] for s in pool])
    x = np.log10(np.array([s["future_views"] for s in pool]) + 1)
    helpful = np.array([s["helpful"] for s in pool])

    fit_x = np.log10(np.array([s["future_views"] for s in load_sample()]) + 1)
    fit_labels = np.array([s["helpful"] for s in load_sample()])
    theta = rm.fit_ml_family(make_saturating_family(float(fit_x.min()), float(fit_x.max())), fit_x, fit_labels)
    probability = saturating_probability(theta, x)

    print(f"pool: {len(pool):,} submitted notes with complete tweet data · "
          f"{helpful.mean():.1%} reached Helpful")
    print_quintile_table(velocity, probability, helpful)
    print_floor_replay(velocity, probability, helpful)
    plot(velocity, probability, helpful)


if __name__ == "__main__":
    main()
