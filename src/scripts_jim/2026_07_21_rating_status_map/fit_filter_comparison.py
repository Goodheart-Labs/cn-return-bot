"""
Velocity floor vs. our P(helpful) filter — which threshold filter better keeps
the notes that ended up helpful while cutting the rest?

Both candidates are monotone scores over a submitted note:
  · velocity   — impressions / age at first sight (the current pipeline floor)
  · P(helpful) — the saturating-sigmoid fitted in fit_views.py (monotone in
                 predicted future views, so thresholding P ≡ thresholding reach)

Positive class = the note ended CURRENTLY_RATED_HELPFUL. Everything else (NMR and
not-helpful) is a negative, because a pre-pipeline filter faces all of them. For
each score we sweep every threshold and report:
  · max F1  — the user's target: keep most eventual-helpful notes (recall) while
              throwing out most of the rest (precision)
  · average precision (PR-AUC) — threshold-free ranking quality, the fair
              head-to-head summary since it doesn't privilege one operating point
  · ROC-AUC — rank separation for reference

Keep-fraction (share of notes passing the filter) is the shared x-axis: velocity
in impressions/hour and P in probability aren't directly comparable, but "what
fraction did we let through" is.

CAVEAT: this is a within-submitted retrospective. We only have outcomes for notes
we actually submitted, and many were already chosen under a velocity floor, so
the low-velocity region is under-sampled — the real gain of either filter on the
full candidate pool is not observable here.
"""
import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score

import ratings_model as rm
from fit_views import load_sample, make_saturating_family, saturating_probability

VELOCITY_COLOR, PROBABILITY_COLOR = "#eb6834", "#184f95"
CURRENT_VELOCITY_FLOOR = 30_000   # REGULAR_VELOCITY_FLOOR_PER_HOUR, for reference


def sweep(scores: np.ndarray, helpful: np.ndarray) -> dict:
    """Max-F1 operating point + threshold-free summaries for one monotone score."""
    precision, recall, thresholds = precision_recall_curve(helpful, scores)
    # precision/recall have one extra entry (recall=0, precision=1) with no threshold.
    f1 = np.divide(2 * precision * recall, precision + recall,
                   out=np.zeros_like(precision), where=(precision + recall) > 0)
    best = int(np.argmax(f1[:-1]))   # exclude the thresholdless tail point
    threshold = thresholds[best]
    keep_fraction = float(np.mean(scores >= threshold))
    return {
        "precision": precision, "recall": recall, "f1_curve": f1,
        "threshold": float(threshold),
        "keep_fraction": keep_fraction,
        "f1": float(f1[best]), "prec": float(precision[best]), "rec": float(recall[best]),
        "average_precision": float(average_precision_score(helpful, scores)),
        "roc_auc": float(roc_auc_score(helpful, scores)),
    }


def main() -> None:
    pool = load_sample(exclude_not_helpful=False)
    helpful = np.array([s["helpful"] for s in pool])
    velocity = np.array([s["velocity"] for s in pool])
    x = np.log10(np.array([s["future_views"] for s in pool]) + 1)

    # The P-model exactly as built: fitted on the helpful-vs-NMR sample, then
    # applied as a score to the whole pool (monotone, so the ranking is identical
    # to ranking by predicted future views).
    fit_x = np.log10(np.array([s["future_views"] for s in load_sample()]) + 1)
    fit_labels = np.array([s["helpful"] for s in load_sample()])
    theta = rm.fit_ml_family(make_saturating_family(float(fit_x.min()), float(fit_x.max())), fit_x, fit_labels)
    probability = saturating_probability(theta, x)

    base_rate = helpful.mean()
    keep_all_f1 = 2 * base_rate / (base_rate + 1)   # recall 1, precision = base rate
    print(f"pool: {len(pool):,} submitted notes with complete tweet data  "
          f"({helpful.sum():,} helpful = {base_rate:.1%}; "
          f"{sum(s['status'] == rm.NOT_HELPFUL for s in pool):,} not-helpful)")
    print(f"no-filter (keep all) F1 = {keep_all_f1:.3f}\n")

    print(f"{'filter':<16} {'PR-AUC':>7} {'ROC-AUC':>8} {'maxF1':>6} "
          f"{'prec':>6} {'recall':>7} {'keep':>6}  operating threshold")
    results = {}
    for name, scores, unit in [("velocity", velocity, "/h"), ("P(helpful)", probability, "")]:
        r = sweep(scores, helpful)
        results[name] = r
        threshold_str = (f"{r['threshold']:,.0f}{unit} impressions/h" if name == "velocity"
                         else f"P ≥ {r['threshold']:.1%}  (≈{10**(np.interp(r['threshold'], probability[np.argsort(probability)], x[np.argsort(probability)])):,.0f} future views)")
        print(f"{name:<16} {r['average_precision']:>7.3f} {r['roc_auc']:>8.3f} {r['f1']:>6.3f} "
              f"{r['prec']:>6.1%} {r['rec']:>7.1%} {r['keep_fraction']:>6.1%}  {threshold_str}")

    print(f"\ncurrent velocity floor {CURRENT_VELOCITY_FLOOR:,}/h would keep "
          f"{np.mean(velocity >= CURRENT_VELOCITY_FLOOR):.1%} of these notes and "
          f"{np.mean(velocity[helpful == 1] >= CURRENT_VELOCITY_FLOOR):.1%} of the helpful ones.")

    plot(velocity, probability, helpful, results, base_rate, keep_all_f1)


def plot(velocity, probability, helpful, results, base_rate, keep_all_f1) -> None:
    fig, (ax_pr, ax_f1) = plt.subplots(1, 2, figsize=(13.5, 5.4), facecolor="white")
    scores = {"velocity": velocity, "P(helpful)": probability}

    for name, color in [("velocity", VELOCITY_COLOR), ("P(helpful)", PROBABILITY_COLOR)]:
        r = results[name]
        ax_pr.plot(r["recall"], r["precision"], color=color, linewidth=2,
                   label=f"{name} (AP {r['average_precision']:.3f})")
        ax_pr.scatter([r["rec"]], [r["prec"]], s=60, facecolors="white",
                      edgecolors=color, linewidths=2, zorder=5)
    ax_pr.axhline(base_rate, color=rm.INK_MUTED, linewidth=1, linestyle=(0, (4, 4)))
    ax_pr.text(0.02, base_rate + 0.006, f"base rate {base_rate:.1%} (submit all)", color=rm.INK_MUTED, fontsize=8)
    ax_pr.set_xlim(0, 1)
    ax_pr.set_ylim(0, max(0.35, max(results[n]["prec"] for n in results) + 0.05))
    ax_pr.set_xlabel("Recall — share of eventual-helpful notes kept", color=rm.INK_MUTED, fontsize=9)
    ax_pr.set_ylabel("Precision — share of kept notes that are helpful", color=rm.INK_MUTED, fontsize=9)
    ax_pr.xaxis.set_major_formatter(plt.matplotlib.ticker.PercentFormatter(xmax=1))
    ax_pr.yaxis.set_major_formatter(plt.matplotlib.ticker.PercentFormatter(xmax=1))
    rm.style_axes(ax_pr, "Precision–recall", "rings = max-F1 operating point")
    ax_pr.legend(frameon=False, fontsize=8.5, labelcolor=rm.INK_MUTED, loc="upper right")

    keep_grid = np.linspace(0.02, 1.0, 200)
    for name, color in [("velocity", VELOCITY_COLOR), ("P(helpful)", PROBABILITY_COLOR)]:
        score = scores[name]
        order = np.argsort(-score)
        helpful_sorted = helpful[order]
        f1_by_keep = []
        for keep in keep_grid:
            k = max(1, int(round(keep * len(score))))
            tp = helpful_sorted[:k].sum()
            precision = tp / k
            recall = tp / helpful.sum()
            f1_by_keep.append(2 * precision * recall / (precision + recall) if precision + recall else 0)
        ax_f1.plot(keep_grid, f1_by_keep, color=color, linewidth=2, label=name)
        ax_f1.scatter([results[name]["keep_fraction"]], [results[name]["f1"]], s=60,
                      facecolors="white", edgecolors=color, linewidths=2, zorder=5)
    ax_f1.axhline(keep_all_f1, color=rm.INK_MUTED, linewidth=1, linestyle=(0, (4, 4)))
    ax_f1.text(0.02, keep_all_f1 + 0.005, f"no filter (F1 {keep_all_f1:.2f})", color=rm.INK_MUTED, fontsize=8)
    ax_f1.set_xlim(0, 1)
    ax_f1.set_ylim(0, None)
    ax_f1.set_xlabel("Keep fraction — share of notes passing the filter", color=rm.INK_MUTED, fontsize=9)
    ax_f1.set_ylabel("F1 (positive = ended helpful)", color=rm.INK_MUTED, fontsize=9)
    ax_f1.xaxis.set_major_formatter(plt.matplotlib.ticker.PercentFormatter(xmax=1))
    rm.style_axes(ax_f1, "F1 vs how much you keep", "rings = each filter's optimum")
    ax_f1.legend(frameon=False, fontsize=8.5, labelcolor=rm.INK_MUTED, loc="lower right")

    fig.tight_layout()
    fig.savefig(rm.HERE / "filter_comparison.png", dpi=160, facecolor="white")
    print("\nwrote filter_comparison.png")


if __name__ == "__main__":
    main()
