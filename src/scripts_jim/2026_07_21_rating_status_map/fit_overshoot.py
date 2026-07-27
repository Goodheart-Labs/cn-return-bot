"""
Fit P(rated helpful | not rated NOT helpful) from the rating count with
overshoot-and-settle curves in x = log10(ratings): a sigmoid rise to a plateau
with a transient peak on top.

Two families, scored on the same CV folds as the polynomial models:

  sigmoid + bump    p(x) = L·sigma(a(x − p)) + C·exp(−(x − m)² / (2s²))
                    plateau L, bump of height C centred at m with width s —
                    the peak's location and width are free parameters.

  two logistics     p(x) = A·sigma(a(x − p)) − B·sigma(b(x − q)),  plateau A − B.

The quadratic logistic in fit_ratings_only.py forces P → 0 as n → infinity, but
the observed tail bins hold at ~16–20%; both families settle onto a plateau
instead of collapsing. Fitted by maximum likelihood (Bernoulli, L-BFGS-B,
multi-start — the likelihoods are non-convex and single starts occasionally land
in bad optima).
"""
import matplotlib.pyplot as plt
import numpy as np
from scipy.special import expit
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

import ratings_model as rm

REPORT_RATING_COUNTS = (10, 25, 50, 100, 200, 400, 1000, 2000)
LOG_N_RANGE = (0.0, 4.0)


def sigmoid_bump_probability(theta: np.ndarray, log_ratings: np.ndarray) -> np.ndarray:
    plateau, slope, center, bump_height, bump_center, bump_width = theta
    curve = (plateau * expit(slope * (log_ratings - center))
             + bump_height * np.exp(-((log_ratings - bump_center) ** 2) / (2 * bump_width**2)))
    return np.clip(curve, rm.PROBABILITY_CLIP, 1 - rm.PROBABILITY_CLIP)


FAMILIES = {
    # theta = (L, a, p, C, m, s)
    "sigmoid + bump": {
        "probability": sigmoid_bump_probability,
        "initial": np.array([0.18, 10.0, 1.3, 0.12, 1.8, 0.3]),
        "bounds": [(1e-3, 1.0), (0.1, 30.0), LOG_N_RANGE, (0.0, 1.0), LOG_N_RANGE, (0.05, 2.0)],
    },
    "two logistics": rm.make_two_logistics_family(*LOG_N_RANGE),
}


def report_metrics(labels: np.ndarray, predictions: np.ndarray, name: str, baseline: float) -> None:
    print(f"{name:<26} {log_loss(labels, predictions):>9.4f} {baseline - log_loss(labels, predictions):>8.4f} "
          f"{roc_auc_score(labels, predictions):>7.3f} {brier_score_loss(labels, predictions):>7.4f}")


def main() -> None:
    notes = rm.load_notes(exclude_not_helpful=True)
    ratings = np.array([n["ratings"] for n in notes])
    labels = np.array([n["helpful"] for n in notes])
    log_ratings = np.log10(ratings)

    base_rate = labels.mean()
    baseline = log_loss(labels, np.full(len(labels), base_rate))
    print(f"n = {len(labels):,}  helpful = {labels.sum():,} ({base_rate:.1%})")
    print(f"{'model':<26} {'log loss':>9} {'vs base':>8} {'AUC':>7} {'Brier':>7}")

    # The quadratic logistic from fit_ratings_only.py on identical folds, for comparison.
    quadratic_features = np.column_stack([log_ratings, log_ratings**2])
    report_metrics(labels, rm.cross_validated_predictions(quadratic_features, labels),
                   "log n + log n² (logistic)", baseline)
    for name, family in FAMILIES.items():
        predictions = rm.cross_validated_predictions(log_ratings[:, None], labels, fit=rm.ml_family_cv_fit(family))
        report_metrics(labels, predictions, name, baseline)

    bump = FAMILIES["sigmoid + bump"]
    theta = rm.fit_ml_family(bump, log_ratings, labels)
    plateau, slope, center, bump_height, bump_center, bump_width = theta
    axis = np.logspace(np.log10(1.5), np.log10(3000), 600)
    curve = sigmoid_bump_probability(theta, np.log10(axis))
    peak_index = int(np.argmax(curve))
    print(f"\nfitted on all data — p(x) = L·σ(a(x−p)) + C·exp(−(x−m)²/2s²), x = log₁₀ n")
    print(f"  L = {plateau:.3f}   a = {slope:.2f}   p = {center:.3f} (n ≈ {10**center:.0f})")
    print(f"  C = {bump_height:.3f}   m = {bump_center:.3f} (n ≈ {10**bump_center:.0f})   s = {bump_width:.3f}"
          f" ({10**bump_width:.1f}× in n)")
    print(f"  peak {curve[peak_index]:.1%} at n ≈ {axis[peak_index]:.0f}   plateau L = {plateau:.1%}")

    reference_theta = rm.fit_ml_family(FAMILIES["two logistics"], log_ratings, labels)
    reference_curve = rm.two_logistics_probability(reference_theta, np.log10(axis))

    bins = rm.bin_by_ratings(notes, "helpful")
    fig, (ax_fit, ax_counts) = plt.subplots(
        2, 1, figsize=(9.5, 7.4), facecolor="white", sharex=True,
        gridspec_kw={"height_ratios": [3.2, 1]})

    ax_fit.plot(axis, reference_curve, color="#9ec5f4", linewidth=1.6, zorder=3)
    ax_fit.text(1000, reference_curve[-1] - 0.045, "two logistics", color="#6da7ec", fontsize=8)
    ax_fit.plot(axis, curve, color="#184f95", linewidth=2.2, zorder=4)
    ax_fit.text(1000, curve[-1] + 0.025, "sigmoid + bump", color="#184f95", fontsize=8)
    ax_fit.axhline(plateau, color="#86b6ef", linewidth=1.2, linestyle=(0, (4, 4)), zorder=1)
    ax_fit.text(1.6, plateau + 0.015, f"plateau {plateau:.1%}", color="#3987e5", fontsize=8)
    for note_bin in bins:
        ax_fit.plot([note_bin["x"], note_bin["x"]], [note_bin["ci_low"], note_bin["ci_high"]],
                    color="#9ec5f4", linewidth=2, solid_capstyle="round", zorder=2)
    ax_fit.scatter([b["x"] for b in bins], [b["rate"] for b in bins], s=52,
                   facecolors="white", edgecolors="#256abf", linewidths=1.8, zorder=5)
    ax_fit.set_ylim(0, 1)
    rm.percent_axis(ax_fit, "y", "P(helpful | not rated unhelpful)")
    rm.style_axes(ax_fit, "Overshoot-and-settle: rise, peak, plateau",
                  "sigmoid + Gaussian bump in log n · rings = observed rate per bin, 95% Wilson intervals")

    ax_counts.bar([b["lo_edge"] for b in bins], [b["count"] for b in bins], align="edge",
                  width=[b["hi_edge"] - b["lo_edge"] for b in bins],
                  color="#cde2fb", edgecolor="white", linewidth=1.5)
    ax_counts.set_ylabel("notes in bin", color=rm.INK_MUTED, fontsize=9)
    rm.style_axes(ax_counts, "", "")
    rm.style_ratings_axis(ax_counts)

    fig.subplots_adjust(left=0.09, right=0.97, top=0.90, bottom=0.09, hspace=0.14)
    fig.savefig(rm.HERE / "overshoot_fit.png", dpi=160, facecolor="white")
    print("\nwrote overshoot_fit.png")

    print(f"\n{'ratings':>10}  {'P(helpful | not unhelpful)':>26}")
    for rating_count, probability in zip(
            REPORT_RATING_COUNTS,
            sigmoid_bump_probability(theta, np.log10(np.array(REPORT_RATING_COUNTS)))):
        print(f"{rating_count:>10}  {probability:>26.1%}")


if __name__ == "__main__":
    main()
