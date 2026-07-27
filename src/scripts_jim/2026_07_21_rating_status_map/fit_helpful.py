"""
Fit P(rated helpful | not rated NOT helpful) from (rating count, helpful share).

Conditioning: CURRENTLY_RATED_NOT_HELPFUL notes are dropped from the sample, so
the question is "among notes that won't be judged unhelpful, which ones actually
make it to helpful rather than sitting at NEEDS_MORE_RATINGS forever?".

Nested logistic models are compared by cross-validated log loss so each extra
term has to earn its place; the winner is plotted as a surface over the plane,
as slices at fixed rating counts, and as a calibration curve.
"""
import matplotlib.pyplot as plt
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

import ratings_model as rm

# Each model is a prefix of this list, so the comparison below is properly nested.
TERMS = [
    ("share", lambda n, s: s),
    ("log n", lambda n, s: n),
    ("log n²", lambda n, s: n**2),
    ("share×log n", lambda n, s: s * n),
]
MODELS = {" + ".join(name for name, _ in TERMS[:k]): TERMS[:k] for k in range(1, len(TERMS) + 1)}

SLICE_RATING_COUNTS = (10, 30, 100, 300)
# Ordinal blue steps 250/400/550/700 — rating count is ordered, not categorical.
SLICE_COLORS = ("#86b6ef", "#3987e5", "#1c5cab", "#0d366b")
SLICE_LABEL_OFFSETS = (0, 0, -0.035, 0.035)   # nudge the 100/300 labels apart
CALIBRATION_BINS = 10
REPORT_RATING_COUNTS = (10, 30, 100, 300, 1000)
REPORT_SHARES = (0.6, 0.75, 0.9, 0.95, 1.0)


def compare_models(ratings: np.ndarray, shares: np.ndarray, labels: np.ndarray) -> str:
    base_rate = labels.mean()
    baseline_predictions = np.full(len(labels), base_rate)
    baseline = log_loss(labels, baseline_predictions)
    print(f"n = {len(labels):,}  helpful = {labels.sum():,} ({base_rate:.1%})")
    print(f"{'model':<40} {'log loss':>9} {'vs base':>8} {'AUC':>7} {'Brier':>7}")
    print(f"{'intercept only (base rate)':<40} {baseline:>9.4f} {'—':>8} {'—':>7} "
          f"{brier_score_loss(labels, baseline_predictions):>7.4f}")

    scores = {}
    for name, terms in MODELS.items():
        predictions = rm.cross_validated_predictions(rm.design_matrix(terms, ratings, shares), labels)
        scores[name] = log_loss(labels, predictions)
        print(f"{name:<40} {scores[name]:>9.4f} {baseline - scores[name]:>8.4f} "
              f"{roc_auc_score(labels, predictions):>7.3f} {brier_score_loss(labels, predictions):>7.4f}")
    return min(scores, key=scores.get)


def draw_surface(fig, ax, predict, bins: list[dict]) -> None:
    grid_ratings, grid_shares = np.meshgrid(np.logspace(np.log10(1.5), np.log10(3000), 300),
                                            np.linspace(0, 1, 300))
    surface = ax.pcolormesh(grid_ratings, grid_shares,
                            predict(grid_ratings.ravel(), grid_shares.ravel()).reshape(grid_ratings.shape),
                            cmap=rm.SEQ, vmin=0, vmax=1, shading="auto")
    ax.scatter([b["x"] for b in bins], [b["y"] for b in bins],
               s=[rm.marker_area(b["count"]) for b in bins], c=[b["rate"] for b in bins],
               cmap=rm.SEQ, vmin=0, vmax=1, edgecolors=rm.INK_MUTED, linewidths=1.2, zorder=3)
    rm.style_ratings_axis(ax)
    rm.percent_axis(ax, "y", "Helpful share — helpful / (helpful + not helpful)")
    ax.set_ylim(0, 1)
    rm.style_axes(ax, "Fitted P(helpful | not rated unhelpful)",
                  "surface = model · dots = observed rate per bin (area ∝ notes)")
    rm.colorbar(fig, surface, ax)


def draw_slices(ax, predict, bins: list[dict]) -> None:
    share_axis = np.linspace(0, 1, 200)
    for rating_count, color, label_offset in zip(SLICE_RATING_COUNTS, SLICE_COLORS, SLICE_LABEL_OFFSETS):
        curve = predict(np.full_like(share_axis, rating_count), share_axis)
        ax.plot(share_axis, curve, color=color, linewidth=2)
        ax.text(1.03, curve[-1] + label_offset, f"{rating_count} ratings",
                color=color, fontsize=8.5, va="center")
        nearby = [b for b in bins if 0.6 * rating_count <= b["x"] <= 1.7 * rating_count]
        ax.scatter([b["y"] for b in nearby], [b["rate"] for b in nearby],
                   s=[10 + 4 * np.sqrt(b["count"]) for b in nearby],
                   facecolors="white", edgecolors=color, linewidths=1.6, zorder=3)
    ax.set_xlim(0, 1.04)
    ax.set_ylim(0, 1)
    rm.percent_axis(ax, "x", "Helpful share")
    rm.percent_axis(ax, "y", "P(helpful | not rated unhelpful)")
    rm.style_axes(ax, "Slices at fixed rating counts", "lines = model · rings = nearby observed bins")


def draw_calibration(ax, out_of_fold: np.ndarray, labels: np.ndarray) -> None:
    order = np.argsort(out_of_fold)
    for predicted_chunk, actual_chunk in zip(np.array_split(out_of_fold[order], CALIBRATION_BINS),
                                             np.array_split(labels[order], CALIBRATION_BINS)):
        ax.scatter(predicted_chunk.mean(), actual_chunk.mean(), s=70,
                   c="#256abf", edgecolors="white", linewidths=1.4, zorder=3)
    ax.plot([0, 1], [0, 1], color=rm.INK_MUTED, linewidth=1, linestyle=(0, (4, 4)), zorder=2)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    rm.percent_axis(ax, "x", "Predicted (out-of-fold)")
    rm.percent_axis(ax, "y", "Observed helpful rate")
    rm.style_axes(ax, "Calibration", f"{CALIBRATION_BINS} equal-size deciles of predicted probability")


def plot(notes, ratings, shares, labels, model_name: str) -> None:
    terms = MODELS[model_name]
    model = LogisticRegression(max_iter=1000).fit(rm.design_matrix(terms, ratings, shares), labels)

    def predict(rating_grid, share_grid):
        return model.predict_proba(rm.design_matrix(terms, rating_grid, share_grid))[:, 1]

    print(f"\nfitted on all data — {model_name}")
    for (term, _), coefficient in zip(terms, model.coef_[0]):
        print(f"  {term:<14} {coefficient:+.3f}")
    print(f"  {'intercept':<14} {model.intercept_[0]:+.3f}")

    bins = rm.bin_by_plane(notes, "helpful")
    fig, (ax_surface, ax_slices, ax_calibration) = plt.subplots(1, 3, figsize=(18, 5.8), facecolor="white")
    draw_surface(fig, ax_surface, predict, bins)
    draw_slices(ax_slices, predict, bins)
    draw_calibration(ax_calibration,
                     rm.cross_validated_predictions(rm.design_matrix(terms, ratings, shares), labels), labels)

    fig.tight_layout()
    fig.savefig(rm.HERE / "helpful_fit.png", dpi=160, facecolor="white")
    print("\nwrote helpful_fit.png")

    print(f"\n{'predicted P(helpful | not unhelpful)':<38}" + "".join(f"{s:>9.0%}" for s in REPORT_SHARES))
    for rating_count in REPORT_RATING_COUNTS:
        row = predict(np.full(len(REPORT_SHARES), rating_count), np.array(REPORT_SHARES))
        print(f"{f'  {rating_count} ratings':<38}" + "".join(f"{p:>9.1%}" for p in row))


def main() -> None:
    notes = rm.load_notes(exclude_not_helpful=True)
    ratings = np.array([n["ratings"] for n in notes])
    shares = np.array([n["helpful_share"] for n in notes])
    labels = np.array([n["helpful"] for n in notes])
    plot(notes, ratings, shares, labels, compare_models(ratings, shares, labels))


if __name__ == "__main__":
    main()
