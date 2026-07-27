"""
Fit P(rated helpful | not rated NOT helpful) from the rating count alone.

The one-input version of fit_helpful.py: same sample and same target, but the
helpful share is withheld, so this measures how much of the signal lives in
"how many people rated it" with no reference to what they said.
"""
import matplotlib.pyplot as plt
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

import ratings_model as rm

TERMS = [
    ("log n", lambda n, s: n),
    ("log n²", lambda n, s: n**2),
    ("log n³", lambda n, s: n**3),
]
MODELS = {" + ".join(name for name, _ in TERMS[:k]): TERMS[:k] for k in range(1, len(TERMS) + 1)}
REPORT_RATING_COUNTS = (10, 25, 50, 100, 200, 400, 1000, 2000)


def compare_models(ratings: np.ndarray, labels: np.ndarray) -> str:
    base_rate = labels.mean()
    baseline_predictions = np.full(len(labels), base_rate)
    baseline = log_loss(labels, baseline_predictions)
    print(f"n = {len(labels):,}  helpful = {labels.sum():,} ({base_rate:.1%})")
    print(f"{'model':<26} {'log loss':>9} {'vs base':>8} {'AUC':>7} {'Brier':>7}")
    print(f"{'intercept only':<26} {baseline:>9.4f} {'—':>8} {'—':>7} "
          f"{brier_score_loss(labels, baseline_predictions):>7.4f}")

    scores = {}
    for name, terms in MODELS.items():
        predictions = rm.cross_validated_predictions(rm.design_matrix(terms, ratings), labels)
        scores[name] = log_loss(labels, predictions)
        print(f"{name:<26} {scores[name]:>9.4f} {baseline - scores[name]:>8.4f} "
              f"{roc_auc_score(labels, predictions):>7.3f} {brier_score_loss(labels, predictions):>7.4f}")
    return min(scores, key=scores.get)


def plot(notes: list[dict], ratings: np.ndarray, labels: np.ndarray, model_name: str) -> None:
    terms = MODELS[model_name]
    model = LogisticRegression(max_iter=1000).fit(rm.design_matrix(terms, ratings), labels)
    print(f"\nfitted on all data — {model_name}")
    for (term, _), coefficient in zip(terms, model.coef_[0]):
        print(f"  {term:<10} {coefficient:+.3f}")
    print(f"  {'intercept':<10} {model.intercept_[0]:+.3f}")

    bins = rm.bin_by_ratings(notes, "helpful")
    rating_axis = np.logspace(np.log10(1.5), np.log10(3000), 400)
    curve = model.predict_proba(rm.design_matrix(terms, rating_axis))[:, 1]

    fig, (ax_fit, ax_counts) = plt.subplots(
        2, 1, figsize=(9.5, 7.4), facecolor="white", sharex=True,
        gridspec_kw={"height_ratios": [3.2, 1]})

    ax_fit.plot(rating_axis, curve, color="#184f95", linewidth=2.2, zorder=4)
    for note_bin in bins:
        ax_fit.plot([note_bin["x"], note_bin["x"]], [note_bin["ci_low"], note_bin["ci_high"]],
                    color="#9ec5f4", linewidth=2, solid_capstyle="round", zorder=2)
    ax_fit.scatter([b["x"] for b in bins], [b["rate"] for b in bins], s=52,
                   facecolors="white", edgecolors="#256abf", linewidths=1.8, zorder=3)
    ax_fit.axhline(labels.mean(), color=rm.INK_MUTED, linewidth=1, linestyle=(0, (4, 4)), zorder=1)
    ax_fit.text(1.6, labels.mean() + 0.02, f"base rate {labels.mean():.1%}",
                color=rm.INK_MUTED, fontsize=8)
    ax_fit.set_ylim(0, 1)
    rm.percent_axis(ax_fit, "y", "P(helpful | not rated unhelpful)")
    rm.style_axes(ax_fit, "Ratings alone: a hump peaking near 100 ratings",
                  "line = fitted model · rings = observed rate per bin, 95% Wilson intervals")

    ax_counts.bar([b["lo_edge"] for b in bins], [b["count"] for b in bins], align="edge",
                  width=[b["hi_edge"] - b["lo_edge"] for b in bins],
                  color="#cde2fb", edgecolor="white", linewidth=1.5)
    ax_counts.set_ylabel("notes in bin", color=rm.INK_MUTED, fontsize=9)
    rm.style_axes(ax_counts, "", "")
    rm.style_ratings_axis(ax_counts)

    fig.subplots_adjust(left=0.09, right=0.97, top=0.90, bottom=0.09, hspace=0.14)
    fig.savefig(rm.HERE / "ratings_only_fit.png", dpi=160, facecolor="white")
    print("\nwrote ratings_only_fit.png")

    print(f"\n{'ratings':>10}  {'P(helpful | not unhelpful)':>26}")
    predicted = model.predict_proba(rm.design_matrix(terms, np.array(REPORT_RATING_COUNTS)))[:, 1]
    for rating_count, probability in zip(REPORT_RATING_COUNTS, predicted):
        print(f"{rating_count:>10}  {probability:>26.1%}")


def main() -> None:
    notes = rm.load_notes(exclude_not_helpful=True)
    ratings = np.array([n["ratings"] for n in notes])
    labels = np.array([n["helpful"] for n in notes])
    plot(notes, ratings, labels, compare_models(ratings, labels))


if __name__ == "__main__":
    main()
