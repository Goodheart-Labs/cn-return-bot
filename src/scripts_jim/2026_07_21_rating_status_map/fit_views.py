"""
From a tweet's (impressions, age in hours) at first sight, predict:

  1. P(note rated helpful | not rated NOT helpful)
  2. E[note views | not rated NOT helpful]   (a NEEDS_MORE_RATINGS note = 0 views)
  3. a combined ranking score blending the two — the candidate replacement for
     the velocity floor in pipeline feed selection.

The single intermediate feature is the tweet's PREDICTED ADDITIONAL VIEWS over
the next week, from the fitted growth curve V(t) ∝ ln(1 + t/τ), τ = 0.8 h:

    future_views = V1 · (ln(1 + (t1+168)/τ) / ln(1 + t1/τ) − 1),  x = log10(future_views + 1)

P(helpful | not unhelpful) is a SATURATING SIGMOID in x — A·σ(a(x−p)), i.e. the
two-logistics family with its drop term degenerate at zero. On CV it beats both
the plain logistic and the full 6-parameter two-logistics (which overfits this
much weaker signal — AUC ≈ 0.59 vs 0.80 on the ratings side; the observed rate
rises monotonically with reach, so there is no overshoot to capture). The full
two-logistics fit is still drawn for comparison.
E[views | helpful] is log-linear in x with a smearing back-transform;
multiplying the two gives E[views | not unhelpful]. The combined score is a
weighted geometric mean of the two, each normalised to its max over the
plausible input range.
"""
import json

import matplotlib.pyplot as plt
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

import ratings_model as rm

GROWTH_TIMESCALE_HOURS = 0.8
WEEK_HOURS = 168.0
MIN_AGE_HOURS = 0.25          # VELOCITY_MIN_AGE_HOURS — very-young ages are sampling noise
CALIBRATION_BINS = 10
COMBINED_WEIGHT = 0.5         # weight on P(helpful); 1−w on expected views
REPORT_IMPRESSIONS = (10_000, 100_000, 1_000_000, 10_000_000)
REPORT_AGES_HOURS = (1, 6, 24, 72)
FUNCTION_AGES_HOURS = (1, 3, 6, 12, 24, 72)
# Ordinal blue steps for the age curves (ordered, not categorical).
AGE_COLORS = ("#86b6ef", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b")


def saturating_probability(theta: np.ndarray, x: np.ndarray) -> np.ndarray:
    """A·σ(a(x−p)) — the two-logistics family with the drop term pinned to zero."""
    amplitude, slope, center = theta
    from scipy.special import expit
    return np.clip(amplitude * expit(slope * (x - center)), rm.PROBABILITY_CLIP, 1 - rm.PROBABILITY_CLIP)


def make_saturating_family(x_low: float, x_high: float) -> dict:
    return {
        "probability": saturating_probability,
        "initial": np.array([0.2, 1.0, x_low + 0.6 * (x_high - x_low)]),
        "bounds": [(1e-3, 1.0), (0.1, 30.0), (x_low, x_high)],
    }


def predicted_future_views(impressions: np.ndarray, age_hours: np.ndarray) -> np.ndarray:
    """Additional views expected over the next week from the ln(1 + t/τ) growth curve."""
    t1 = np.maximum(age_hours, MIN_AGE_HOURS)
    growth = np.log1p((t1 + WEEK_HOURS) / GROWTH_TIMESCALE_HOURS) / np.log1p(t1 / GROWTH_TIMESCALE_HOURS)
    return impressions * (growth - 1)


def load_sample(exclude_not_helpful: bool = True) -> list[dict]:
    """
    Submitted notes with complete tweet data. NOT_HELPFUL rows are excluded by
    default (the P-model's conditioning); pass False for operational analyses
    where the filter faces every submission.
    """
    sample = []
    for row in json.loads((rm.HERE / "views_sample.json").read_text()):
        if row.get("impressions") is None or not row.get("posted_at") or not row.get("first_seen_at"):
            continue
        if (exclude_not_helpful and row["cn_status"] == rm.NOT_HELPFUL) or row["cn_status"] is None:
            continue
        age_hours = (np.datetime64(row["first_seen_at"].replace("Z", "").split("+")[0])
                     - np.datetime64(row["posted_at"].replace("Z", "").split("+")[0])) / np.timedelta64(1, "h")
        sample.append({
            "note_id": row["note_id"],
            "future_views": float(predicted_future_views(np.array(row["impressions"]), np.array(age_hours))),
            "velocity": row["impressions"] / max(float(age_hours), MIN_AGE_HOURS),
            "helpful": int(row["cn_status"] == rm.HELPFUL),
            "note_views": row["view_count"],   # None when the scraper never captured it
            "feed_size": row.get("feed_size"),   # submitting run's pick; None pre-tracking
            "status": row["cn_status"],
        })
    return sample


def fit_views_given_helpful(x: np.ndarray, note_views: np.ndarray):
    """Log-linear E[note views | helpful] with a smearing back-transform, and its parameters."""
    log_views = np.log10(note_views + 1)
    slope, intercept = np.polyfit(x, log_views, 1)
    smear = float(np.mean(10 ** (log_views - (intercept + slope * x))))
    return (lambda grid: smear * 10 ** (intercept + slope * grid) - 1), slope, intercept, smear


def capture_curve(scores: np.ndarray, realized: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Fraction of total realized views captured when keeping the top-k by score."""
    order = np.argsort(-scores)
    captured = np.concatenate([[0.0], np.cumsum(realized[order]) / realized.sum()])
    return np.linspace(0, 1, len(captured)), captured


def main() -> None:
    sample = load_sample()
    x = np.log10(np.array([s["future_views"] for s in sample]) + 1)
    labels = np.array([s["helpful"] for s in sample])
    print(f"n = {len(sample):,}  helpful = {labels.sum():,} ({labels.mean():.1%})")
    print(f"future-views x range: p1 {10**np.quantile(x, .01):,.0f}  median {10**np.median(x):,.0f}  "
          f"p99 {10**np.quantile(x, .99):,.0f}")

    # ── P(helpful | not unhelpful) ──────────────────────────────────────────
    # The observed rate rises monotonically with reach (no overshoot), so the
    # full two-logistics overfits; its degenerate form — a saturating sigmoid,
    # drop term pinned to zero — wins the CV comparison and is the headline.
    x_range = float(x.min()), float(x.max())
    saturating_family = make_saturating_family(*x_range)
    two_logistics_family = rm.make_two_logistics_family(*x_range)
    baseline = log_loss(labels, np.full(len(labels), labels.mean()))
    out_of_fold = rm.cross_validated_predictions(x[:, None], labels, fit=rm.ml_family_cv_fit(saturating_family))
    print(f"\n{'model':<30} {'log loss':>9} {'vs base':>8} {'AUC':>7} {'Brier':>7}")
    print(f"{'intercept only':<30} {baseline:>9.4f} {'—':>8} {'—':>7} "
          f"{brier_score_loss(labels, np.full(len(labels), labels.mean())):>7.4f}")
    comparisons = [
        ("A·σ(a(x−p)) (chosen)", out_of_fold),
        ("plain logistic", rm.cross_validated_predictions(x[:, None], labels)),
        ("two logistics (full)", rm.cross_validated_predictions(
            x[:, None], labels, fit=rm.ml_family_cv_fit(two_logistics_family))),
    ]
    for name, oof in comparisons:
        print(f"{name:<30} {log_loss(labels, oof):>9.4f} {baseline - log_loss(labels, oof):>8.4f} "
              f"{roc_auc_score(labels, oof):>7.3f} {brier_score_loss(labels, oof):>7.4f}")

    theta = rm.fit_ml_family(saturating_family, x, labels)
    probability = lambda grid: saturating_probability(theta, grid)
    overshoot_theta = rm.fit_ml_family(two_logistics_family, x, labels)
    overshoot_curve = lambda grid: rm.two_logistics_probability(overshoot_theta, grid)
    print(f"\nP(helpful | not unhelpful) = {theta[0]:.3f}·σ({theta[1]:.2f}·(x − {theta[2]:.3f})),"
          f"  x = log₁₀(future_views + 1)   [saturates at {theta[0]:.1%}; midpoint ≈{10**theta[2]:,.0f} views]")

    # ── E[note views | not unhelpful] ───────────────────────────────────────
    # NMR notes contribute 0 by definition; helpful notes need a scraped count.
    views_known = np.array([s["note_views"] is not None or s["helpful"] == 0 for s in sample])
    realized_views = np.array([(s["note_views"] or 0) if s["helpful"] else 0 for s in sample], dtype=float)
    helpful_with_views = np.array([bool(s["helpful"]) and s["note_views"] is not None for s in sample])
    views_given_helpful, slope, intercept, smear = fit_views_given_helpful(
        x[helpful_with_views], realized_views[helpful_with_views])
    expected_views = lambda grid: probability(grid) * views_given_helpful(grid)
    print(f"\nE[views | helpful] = {smear:.3f}·10^({intercept:.3f} + {slope:.3f}·x) − 1")
    print(f"E[views | not unhelpful] = P(helpful | not unhelpful) · E[views | helpful]")
    print(f"(fit on {helpful_with_views.sum()} helpful notes with scraped views; "
          f"{int((~views_known).sum())} helpful notes lack a count and are excluded from view fitting)")

    # ── Combined ranking score ──────────────────────────────────────────────
    # Normalise over the whole plausible input span (1e3–1e8 impressions, ≥1 h),
    # not just the observed sample, so extrapolated scores stay inside [0, 1].
    grid = np.linspace(x.min(), np.log10(predicted_future_views(np.array(1e8), np.array(1.0)) + 1), 600)
    probability_max, views_max = probability(grid).max(), expected_views(grid).max()
    combined = lambda g: ((probability(g) / probability_max) ** COMBINED_WEIGHT
                          * (np.maximum(expected_views(g), 0) / views_max) ** (1 - COMBINED_WEIGHT))
    print(f"\nscore = (P/P_max)^{COMBINED_WEIGHT} · (E[views]/E_max)^{1 - COMBINED_WEIGHT}"
          f"   with P_max = {probability_max:.3f}, E_max = {views_max:,.0f}")

    # All three functions are monotone in the one feature x, so they induce the
    # SAME ranking — the combined score only reorders against a different signal.
    # The ranking comparison that matters is future-views vs the current
    # pipeline criterion, velocity (impressions/hour at first sight).
    velocity = np.array([s_["velocity"] for s_ in sample])
    print("\nnote: P, E[views] and the combined score are all monotone in x — identical rankings;")
    print("the capture plot compares that shared ranking against velocity.")

    # Fixed edges, not quantiles: the bottom quantile bin spanned four decades
    # and drew its 4% rate at a misleading geometric center. Below 1k future
    # views the data is one story (1/109 helpful) → one merged bin; half-decade
    # bins above.
    top = np.ceil(x.max())
    edges = np.concatenate([[1.0], np.logspace(3, top, int(2 * (top - 3)) + 1)])
    bins = rm.bin_binary(10**x, labels, edges)
    plot_fit(x, bins, probability, overshoot_curve)
    plot_functions(probability, expected_views, combined)
    plot_goodness(x, labels, out_of_fold, realized_views, views_known, helpful_with_views,
                  probability, expected_views, combined, edges, velocity)

    print(f"\n{'impressions':>12} {'age':>5}  {'future views':>13} {'P(helpful)':>11} {'E[views]':>10} {'score':>7}")
    for impressions in REPORT_IMPRESSIONS:
        for age in REPORT_AGES_HOURS:
            future = predicted_future_views(np.array(impressions, dtype=float), np.array(age, dtype=float))
            grid_point = np.array([np.log10(future + 1)])
            print(f"{impressions:>12,} {age:>4}h  {future:>13,.0f} {probability(grid_point)[0]:>11.1%} "
                  f"{expected_views(grid_point)[0]:>10,.0f} {combined(grid_point)[0]:>7.3f}")


def plot_fit(x, bins, probability, overshoot_curve) -> None:
    axis = np.logspace(x.min(), x.max(), 600)
    curve = probability(np.log10(axis))
    reference = overshoot_curve(np.log10(axis))

    fig, (ax_fit, ax_counts) = plt.subplots(
        2, 1, figsize=(9.5, 7.4), facecolor="white", sharex=True,
        gridspec_kw={"height_ratios": [3.2, 1]})
    ax_fit.plot(axis, reference, color="#9ec5f4", linewidth=1.6, zorder=3)
    ax_fit.text(axis[-1], reference[-1] - 0.022, "two logistics, full (overfits)",
                color="#6da7ec", fontsize=8, ha="right")
    ax_fit.plot(axis, curve, color="#184f95", linewidth=2.2, zorder=4)
    ax_fit.text(axis[-1], curve[-1] + 0.012, "A·σ(a(x−p)) (chosen)", color="#184f95", fontsize=8, ha="right")
    for b in bins:
        ax_fit.plot([b["x"], b["x"]], [b["ci_low"], b["ci_high"]],
                    color="#9ec5f4", linewidth=2, solid_capstyle="round", zorder=2)
    ax_fit.scatter([b["x"] for b in bins], [b["rate"] for b in bins], s=52,
                   facecolors="white", edgecolors="#256abf", linewidths=1.8, zorder=3)
    ax_fit.set_ylim(0, max(0.35, max(b["ci_high"] for b in bins) + 0.05))
    ax_fit.set_yticks(np.arange(0, ax_fit.get_ylim()[1], 0.1))
    ax_fit.set_yticklabels([f"{v:.0%}" for v in ax_fit.get_yticks()])
    ax_fit.set_ylabel("P(helpful | not rated unhelpful)", color=rm.INK_MUTED, fontsize=9)
    rm.style_axes(ax_fit, "Predicted future tweet views → P(note rated helpful)",
                  "dark = saturating sigmoid A·σ(a(x−p)), CV winner · light = full two logistics · rings = half-decade bins (merged below 1k), 95% Wilson CIs")

    # Fixed log-spaced edges here — the quantile bins above are flat by construction.
    histogram_edges = np.logspace(0, np.ceil(x.max()), int(2 * np.ceil(x.max())) + 1)
    counts, _ = np.histogram(10**x, bins=histogram_edges)
    ax_counts.bar(histogram_edges[:-1], counts, align="edge",
                  width=np.diff(histogram_edges), color="#cde2fb", edgecolor="white", linewidth=1.5)
    ax_counts.set_ylabel("notes in bin", color=rm.INK_MUTED, fontsize=9)
    rm.style_axes(ax_counts, "", "")
    ax_counts.set_xscale("log")
    ax_counts.set_xlabel("Predicted additional tweet views over the next week", color=rm.INK_MUTED, fontsize=9)

    fig.subplots_adjust(left=0.09, right=0.97, top=0.90, bottom=0.09, hspace=0.14)
    fig.savefig(rm.HERE / "views_fit.png", dpi=160, facecolor="white")
    print("\nwrote views_fit.png")


def plot_functions(probability, expected_views, combined) -> None:
    impressions_axis = np.logspace(3, 8, 400)
    fig, axes = plt.subplots(1, 3, figsize=(16.5, 5.2), facecolor="white")
    panels = [(axes[0], probability, "P(helpful | not rated unhelpful)", "Probability of helpful"),
              (axes[1], expected_views, "E[note views | not rated unhelpful]", "Expected note views"),
              (axes[2], combined, "Combined ranking score", "Combined ranking score")]
    for ax, function, label, title in panels:
        for age, color in zip(FUNCTION_AGES_HOURS, AGE_COLORS):
            future = predicted_future_views(impressions_axis, np.full_like(impressions_axis, float(age)))
            ax.plot(impressions_axis, function(np.log10(future + 1)), color=color,
                    linewidth=2, label=f"{age} h old")
        ax.set_xscale("log")
        ax.set_xlabel("Tweet impressions at first sight", color=rm.INK_MUTED, fontsize=9)
        ax.set_ylabel(label, color=rm.INK_MUTED, fontsize=9)
        rm.style_axes(ax, title, "by tweet age when fetched")
    axes[1].set_yscale("log")
    axes[1].set_ylim(bottom=10)
    axes[0].yaxis.set_major_formatter(plt.matplotlib.ticker.PercentFormatter(xmax=1))
    axes[0].legend(frameon=False, fontsize=8, labelcolor=rm.INK_MUTED, loc="upper left")
    fig.tight_layout()
    fig.savefig(rm.HERE / "views_functions.png", dpi=160, facecolor="white")
    print("wrote views_functions.png")


def plot_goodness(x, labels, out_of_fold, realized_views, views_known, helpful_with_views,
                  probability, expected_views, combined, edges, velocity) -> None:
    fig, (ax_calibration, ax_views, ax_capture) = plt.subplots(1, 3, figsize=(16.5, 5.2), facecolor="white")

    # Calibration of P(helpful), out-of-fold deciles.
    order = np.argsort(out_of_fold)
    for predicted_chunk, actual_chunk in zip(np.array_split(out_of_fold[order], CALIBRATION_BINS),
                                             np.array_split(labels[order], CALIBRATION_BINS)):
        ax_calibration.scatter(predicted_chunk.mean(), actual_chunk.mean(), s=70,
                               c="#256abf", edgecolors="white", linewidths=1.4, zorder=3)
    limit = 0.3
    ax_calibration.plot([0, limit], [0, limit], color=rm.INK_MUTED, linewidth=1, linestyle=(0, (4, 4)))
    ax_calibration.set_xlim(0, limit)
    ax_calibration.set_ylim(0, limit)
    ax_calibration.set_xlabel("Predicted P(helpful), out-of-fold", color=rm.INK_MUTED, fontsize=9)
    ax_calibration.set_ylabel("Observed helpful rate", color=rm.INK_MUTED, fontsize=9)
    rm.style_axes(ax_calibration, "P(helpful) calibration", f"{CALIBRATION_BINS} equal-size deciles")

    # Expected vs realized note views per future-views bin (rows with a known count).
    known_x, known_views = x[views_known], realized_views[views_known]
    for lo, hi in zip(edges[:-1], edges[1:]):
        in_bin = (10**known_x >= lo) & (10**known_x < hi)
        if in_bin.sum() < rm.MIN_NOTES_PER_BIN:
            continue
        center = np.sqrt(lo * hi)
        ax_views.scatter(center, known_views[in_bin].mean(), s=52, facecolors="white",
                         edgecolors="#256abf", linewidths=1.8, zorder=3)
    axis = np.logspace(x.min(), x.max(), 400)
    ax_views.plot(axis, expected_views(np.log10(axis)), color="#184f95", linewidth=2.2, zorder=2)
    ax_views.set_xscale("log")
    ax_views.set_xlabel("Predicted additional tweet views (next week)", color=rm.INK_MUTED, fontsize=9)
    ax_views.set_ylabel("Note views (NMR = 0)", color=rm.INK_MUTED, fontsize=9)
    rm.style_axes(ax_views, "E[note views] vs realized",
                  "line = model · rings = mean realized views per half-decade bin")

    # Capture curves: how much of the realized note-view mass each ranker keeps.
    # P, E[views] and combined are monotone in x → identical rankings, one curve.
    capture_sample = views_known
    for scores, color, label in [
            (combined(x), "#184f95", "rank by score (P / E[views] / combined coincide)"),
            (velocity, "#eb6834", "rank by velocity (current pipeline)")]:
        fraction, captured = capture_curve(scores[capture_sample], realized_views[capture_sample])
        ax_capture.plot(fraction, captured, color=color, linewidth=2, label=label)
    ax_capture.plot([0, 1], [0, 1], color=rm.INK_MUTED, linewidth=1, linestyle=(0, (4, 4)))
    ax_capture.set_xlabel("Fraction of notes kept (ranked best-first)", color=rm.INK_MUTED, fontsize=9)
    ax_capture.set_ylabel("Fraction of realized note views captured", color=rm.INK_MUTED, fontsize=9)
    rm.style_axes(ax_capture, "Ranking quality", "dashed = random order")
    ax_capture.legend(frameon=False, fontsize=8, labelcolor=rm.INK_MUTED, loc="lower right")

    fig.tight_layout()
    fig.savefig(rm.HERE / "views_goodness.png", dpi=160, facecolor="white")
    print("wrote views_goodness.png")


if __name__ == "__main__":
    main()
