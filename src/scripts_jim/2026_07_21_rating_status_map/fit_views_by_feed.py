"""
Does the P(helpful | not unhelpful) model survive conditioning on the feed?

The pooled fit (fit_views.py) could owe its skill to feed identity: the small
feed selects high-velocity posts and the large/xl/xxl tiers reach further down,
so "more predicted reach → more helpful" might just be "small feed → more
helpful". Here each note is bucketed by its submitting run's feed_size pick
(small vs large|xl|xxl, the project's convention) and the POOLED model is
evaluated within each bucket: does x still discriminate and stay calibrated
once the feed is held fixed? A per-feed refit is drawn alongside to show how
much the curve itself moves.
"""
import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

import ratings_model as rm
from fit_views import load_sample, make_saturating_family, saturating_probability

LARGE_TIERS = {"large", "xl", "xxl"}
FEED_COLOR = {"small": "#eb6834", "large": "#2a78d6"}


def feed_bucket(feed_size: str | None) -> str | None:
    if feed_size == "small":
        return "small"
    if feed_size in LARGE_TIERS:
        return "large"
    return None


def evaluate_bucket(name: str, x: np.ndarray, labels: np.ndarray, pooled_probability) -> dict:
    """Pooled-model skill within one feed: discrimination, and loss vs the bucket's own base rate."""
    base_rate = labels.mean()
    baseline = log_loss(labels, np.full(len(labels), base_rate))
    pooled = np.clip(pooled_probability(x), 1e-9, 1 - 1e-9)
    metrics = {
        "name": name,
        "n": len(labels),
        "helpful_rate": base_rate,
        "baseline": baseline,
        "log_loss": log_loss(labels, pooled),
        "auc": roc_auc_score(labels, pooled) if 0 < labels.sum() < len(labels) else float("nan"),
        "brier": brier_score_loss(labels, pooled),
        "mean_predicted": pooled.mean(),
    }
    print(f"{name:<22} {metrics['n']:>5,} {base_rate:>8.1%} {pooled.mean():>9.1%} "
          f"{baseline:>9.4f} {metrics['log_loss']:>9.4f} {baseline - metrics['log_loss']:>8.4f} "
          f"{metrics['auc']:>7.3f}")
    return metrics


def main() -> None:
    sample = [s for s in load_sample() if feed_bucket(s.get("feed_size"))]
    x = np.log10(np.array([s["future_views"] for s in sample]) + 1)
    labels = np.array([s["helpful"] for s in sample])
    buckets = np.array([feed_bucket(s["feed_size"]) for s in sample])
    print(f"notes with a feed pick: {len(sample):,} "
          f"(small {int((buckets == 'small').sum()):,} / large {int((buckets == 'large').sum()):,})")

    # The pooled model, refit on the feed-labelled subsample (same family as fit_views).
    pooled_family = make_saturating_family(float(x.min()), float(x.max()))
    pooled_theta = rm.fit_ml_family(pooled_family, x, labels)
    pooled_probability = lambda grid: saturating_probability(pooled_theta, grid)
    print(f"pooled fit on this subsample: {pooled_theta[0]:.3f}·σ({pooled_theta[1]:.2f}·(x − {pooled_theta[2]:.3f}))")

    print(f"\n{'bucket':<22} {'n':>5} {'helpful':>8} {'pred.mean':>9} {'base LL':>9} {'model LL':>9} {'vs base':>8} {'AUC':>7}")
    metrics = [evaluate_bucket("all (with feed pick)", x, labels, pooled_probability)]
    per_feed_curves = {}
    for feed in ("small", "large"):
        mask = buckets == feed
        metrics.append(evaluate_bucket(feed, x[mask], labels[mask], pooled_probability))
        feed_theta = rm.fit_ml_family(
            make_saturating_family(float(x[mask].min()), float(x[mask].max())), x[mask], labels[mask])
        per_feed_curves[feed] = feed_theta
        print(f"{'  refit':<22} {feed_theta[0]:.3f}·σ({feed_theta[1]:.2f}·(x − {feed_theta[2]:.3f}))"
              f"   [cap {feed_theta[0]:.1%}, midpoint ≈{10**feed_theta[2]:,.0f} views]")

    plot(x, labels, buckets, pooled_probability, per_feed_curves)


def plot(x, labels, buckets, pooled_probability, per_feed_curves) -> None:
    top = np.ceil(x.max())
    edges = np.concatenate([[1.0], np.logspace(3, top, int(2 * (top - 3)) + 1)])
    axis = np.logspace(x.min(), x.max(), 500)

    fig, axes = plt.subplots(1, 2, figsize=(13.5, 5.4), facecolor="white", sharey=True)
    for ax, feed in zip(axes, ("small", "large")):
        mask = buckets == feed
        bins = rm.bin_binary(10**x[mask], labels[mask], edges)
        ax.plot(axis, pooled_probability(np.log10(axis)), color=rm.INK_MUTED,
                linewidth=1.6, linestyle=(0, (4, 4)), zorder=2)
        ax.plot(axis, saturating_probability(per_feed_curves[feed], np.log10(axis)),
                color=FEED_COLOR[feed], linewidth=2.2, zorder=4)
        for b in bins:
            ax.plot([b["x"], b["x"]], [b["ci_low"], b["ci_high"]],
                    color="#9ec5f4", linewidth=2, solid_capstyle="round", zorder=1)
        ax.scatter([b["x"] for b in bins], [b["rate"] for b in bins], s=52,
                   facecolors="white", edgecolors=FEED_COLOR[feed], linewidths=1.8, zorder=5)
        ax.set_xscale("log")
        ax.set_ylim(0, 0.42)
        ax.set_xlabel("Predicted additional tweet views (next week)", color=rm.INK_MUTED, fontsize=9)
        count = int(mask.sum())
        rate = labels[mask].mean()
        rm.style_axes(ax, f"{feed.capitalize()} feed",
                      f"{count:,} notes · {rate:.1%} helpful · solid = refit on this feed · dashed = pooled model")
    axes[0].set_yticks(np.arange(0, 0.41, 0.1))
    axes[0].set_yticklabels([f"{v:.0%}" for v in axes[0].get_yticks()])
    axes[0].set_ylabel("P(helpful | not rated unhelpful)", color=rm.INK_MUTED, fontsize=9)

    fig.tight_layout()
    fig.savefig(rm.HERE / "views_by_feed.png", dpi=160, facecolor="white")
    print("\nwrote views_by_feed.png")


if __name__ == "__main__":
    main()
