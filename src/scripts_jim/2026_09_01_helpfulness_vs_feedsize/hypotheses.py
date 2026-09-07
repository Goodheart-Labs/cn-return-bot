# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "matplotlib", "pandas", "statsmodels"]
# ///
"""Both hypothesis tests and their figures.

Hypothesis 1: a smaller feed tier makes a settled note more likely to be
helpful rather than unhelpful. Tested as P(helpful | settled) with tier and
era adjustment.
Hypothesis 2: a higher velocity makes a submitted note more likely to settle
to a verdict at all. Tested as P(settled | submitted).

Figures:
  helpful_unhelpful_by_tier.png  P(helpful | submitted) and P(unhelpful | submitted)
                                 per tier over velocity, Wilson bands, bin counts.
  epoch_stability.png            the same curves split by floor era.
  settling_over_time.png         settled share vs note age (censoring check).

The models print odds ratios with confidence intervals and a likelihood-ratio
test for the tier block. Everything reads data/frame.json from build_frame.py.
"""

import json
import math
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
OUT_DIR = os.path.dirname(__file__)
REGULAR_TIERS = ("small", "large", "xl")
SETTLE_DAYS = 7
SETTLE_DAYS_SENSITIVITY = 14
HELPFUL = "CURRENTLY_RATED_HELPFUL"
UNHELPFUL = "CURRENTLY_RATED_NOT_HELPFUL"
BINS_PER_TIER = {"small": 5, "large": 5, "xl": 4}
BINS_PER_ERA_CURVE = 4
MIN_NOTES_PER_ERA_CURVE = 60
FLOOR_HISTORY = [5_000, 15_000, 30_000]
AGE_BIN_EDGES_DAYS = [1, 3, 5, 7, 10, 14, 21, 28, 45, 90]

# The one-week 30k era is too small to stand alone, so the models and the era
# figure use three eras: pre-floor, high floor (30k+15k pooled), and 5k.
ERA3 = {"E0 no floor": "pre-floor", "E1 30k": "high floor", "E2 15k": "high floor", "E3 5k": "5k floor"}
ERA3_ORDER = ["pre-floor", "high floor", "5k floor"]

COL_HELPFUL = "#2a78d6"
COL_UNHELPFUL = "#eb6834"
ERA_COLORS = {"pre-floor": "#86b6ef", "high floor": "#2a78d6", "5k floor": "#104281"}
SURFACE = "#fcfcfb"
TEXT_PRIMARY = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e6e5e1"

plt.rcParams.update(
    {
        "figure.facecolor": SURFACE,
        "axes.facecolor": SURFACE,
        "savefig.facecolor": SURFACE,
        "text.color": TEXT_PRIMARY,
        "axes.labelcolor": TEXT_SECONDARY,
        "xtick.color": TEXT_SECONDARY,
        "ytick.color": TEXT_SECONDARY,
        "axes.edgecolor": GRID,
        "font.size": 10,
    }
)


def load_frame():
    frame = pd.DataFrame(json.load(open(os.path.join(DATA_DIR, "frame.json"))))
    frame["era3"] = frame["era"].map(ERA3)
    frame["helpful"] = (frame["status"] == HELPFUL).astype(int)
    frame["unhelpful"] = (frame["status"] == UNHELPFUL).astype(int)
    frame["settled"] = frame["helpful"] | frame["unhelpful"]
    return frame


def eligible_submitted(frame, settle_days=SETTLE_DAYS):
    return frame[frame["submitted"] & (frame["days_since_submission"] >= settle_days)]


def wilson(k, n, z=1.96):
    """95% Wilson score interval for a binomial proportion."""
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (center - half, center + half)


def equal_count_bins(logvels, n_bins):
    edges = np.quantile(logvels, np.linspace(0, 1, n_bins + 1))
    edges[0] -= 1e-9
    edges[-1] += 1e-9
    return np.unique(edges)


def binned_rates(sub, n_bins):
    """Per equal-count velocity bin: median velocity, P(helpful), P(unhelpful),
    Wilson intervals, and the bin size."""
    edges = equal_count_bins(sub["logvel"].to_numpy(), n_bins)
    rows = []
    for lo, hi in zip(edges, edges[1:]):
        in_bin = sub[(sub["logvel"] > lo) & (sub["logvel"] <= hi)]
        n = len(in_bin)
        if n == 0:
            continue
        h = int(in_bin["helpful"].sum())
        u = int(in_bin["unhelpful"].sum())
        rows.append(
            {
                "vel": float(10 ** in_bin["logvel"].median()),
                "n": n,
                "pH": h / n,
                "pH_lo": wilson(h, n)[0],
                "pH_hi": wilson(h, n)[1],
                "pU": u / n,
                "pU_lo": wilson(u, n)[0],
                "pU_hi": wilson(u, n)[1],
            }
        )
    return pd.DataFrame(rows)


def draw_floor_markers(ax):
    for floor in FLOOR_HISTORY:
        ax.axvline(floor, color=GRID, linestyle="--", linewidth=1, zorder=1)
        ax.annotate(
            f"{floor // 1000}k", (floor, 0.965), xycoords=("data", "axes fraction"),
            ha="center", va="top", fontsize=7, color=TEXT_SECONDARY,
        )


def style_velocity_axis(ax):
    ax.set_xscale("log")
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.spines[["top", "right"]].set_visible(False)
    ax.set_xlabel("velocity at decision (impressions/h)")


def plot_rate_pair(ax, rates):
    for col, lo, hi, color, label in [
        ("pH", "pH_lo", "pH_hi", COL_HELPFUL, "P(helpful)"),
        ("pU", "pU_lo", "pU_hi", COL_UNHELPFUL, "P(unhelpful)"),
    ]:
        ax.plot(rates["vel"], rates[col], color=color, linewidth=2, marker="o", markersize=5, label=label)
        ax.fill_between(rates["vel"], rates[lo], rates[hi], color=color, alpha=0.15, linewidth=0)


def main_figure(frame):
    sub = eligible_submitted(frame)
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.4), sharey=True)
    for ax, tier in zip(axes, REGULAR_TIERS):
        tier_sub = sub[sub["tier"] == tier]
        rates = binned_rates(tier_sub, BINS_PER_TIER[tier])
        plot_rate_pair(ax, rates)
        ax.annotate(
            f"equal-count bins, n≈{int(rates['n'].median())} each",
            (0.98, 0.03), xycoords="axes fraction", ha="right", fontsize=7.5, color=TEXT_SECONDARY,
        )
        draw_floor_markers(ax)
        if tier == "xl":
            ax.axvspan(rates["vel"].min() / 10, 5_000, color=GRID, alpha=0.5, zorder=0)
            ax.annotate(
                "no data in any era\n(ladder never picked slow xl)",
                (0.03, 0.86), xycoords="axes fraction", fontsize=7.5, color=TEXT_SECONDARY,
            )
        style_velocity_axis(ax)
        ax.set_title(f"{tier}  (submitted n={len(tier_sub)})", fontsize=11)
    axes[0].set_ylabel("share of submitted notes (settled ≥7d)")
    axes[1].legend(frameon=False, loc="upper left", fontsize=9)
    fig.suptitle("P(helpful) and P(unhelpful) per submitted note, by feed tier and velocity", y=1.02)
    fig.text(
        0, -0.06,
        "Sub-5k velocities come almost entirely from the pre-floor era (before 2026-07-21); "
        "the dashed lines mark the historical velocity floors.",
        fontsize=8, color=TEXT_SECONDARY,
    )
    fig.tight_layout()
    fig.savefig(os.path.join(OUT_DIR, "helpful_unhelpful_by_tier.png"), dpi=160, bbox_inches="tight")
    plt.close(fig)


def era_figure(frame):
    sub = eligible_submitted(frame)
    fig, axes = plt.subplots(2, 3, figsize=(13, 7.2), sharey="row", sharex=True)
    for row_idx, (col, lo, hi, what) in enumerate(
        [("pH", "pH_lo", "pH_hi", "P(helpful)"), ("pU", "pU_lo", "pU_hi", "P(unhelpful)")]
    ):
        for ax, tier in zip(axes[row_idx], REGULAR_TIERS):
            for era in ERA3_ORDER:
                era_sub = sub[(sub["tier"] == tier) & (sub["era3"] == era)]
                if len(era_sub) < MIN_NOTES_PER_ERA_CURVE:
                    continue
                rates = binned_rates(era_sub, BINS_PER_ERA_CURVE)
                ax.plot(
                    rates["vel"], rates[col], color=ERA_COLORS[era], linewidth=2,
                    marker="o", markersize=5, label=f"{era} (n={len(era_sub)})",
                )
                ax.fill_between(rates["vel"], rates[lo], rates[hi], color=ERA_COLORS[era], alpha=0.12, linewidth=0)
            if row_idx == 0:
                ax.set_title(tier, fontsize=11)
            style_velocity_axis(ax)
            if row_idx == 0:
                ax.set_xlabel("")
            ax.legend(frameon=False, fontsize=8)
        axes[row_idx][0].set_ylabel(f"{what} per submitted note")
    fig.suptitle("Era stability: the same curves per floor era", y=1.0)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT_DIR, "epoch_stability.png"), dpi=160, bbox_inches="tight")
    plt.close(fig)


def settling_figure(frame):
    """Cross-sectional settling check: among notes of a given age, what share
    is currently settled helpful / unhelpful. If the shares keep growing well
    past 7 days, the 7-day horizon is too green."""
    sub = frame[frame["submitted"] & (frame["days_since_submission"] >= AGE_BIN_EDGES_DAYS[0])]
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.2), sharey=True)
    for ax, tier in zip(axes, REGULAR_TIERS):
        tier_sub = sub[sub["tier"] == tier]
        rows = []
        for lo, hi in zip(AGE_BIN_EDGES_DAYS, AGE_BIN_EDGES_DAYS[1:]):
            in_bin = tier_sub[(tier_sub["days_since_submission"] >= lo) & (tier_sub["days_since_submission"] < hi)]
            if len(in_bin) < 10:
                continue
            rows.append(
                {
                    "age": (lo + hi) / 2,
                    "n": len(in_bin),
                    "pH": in_bin["helpful"].mean(),
                    "pU": in_bin["unhelpful"].mean(),
                }
            )
        rates = pd.DataFrame(rows)
        ax.plot(rates["age"], rates["pH"], color=COL_HELPFUL, linewidth=2, marker="o", markersize=5, label="settled helpful")
        ax.plot(rates["age"], rates["pU"], color=COL_UNHELPFUL, linewidth=2, marker="o", markersize=5, label="settled unhelpful")
        ax.axvline(SETTLE_DAYS, color=GRID, linestyle="--", linewidth=1)
        ax.set_title(f"{tier} (n={len(tier_sub)})", fontsize=11)
        ax.grid(axis="y", color=GRID, linewidth=0.8)
        ax.spines[["top", "right"]].set_visible(False)
        ax.set_xlabel("note age (days since submission)")
    axes[0].set_ylabel("share of submitted notes currently settled")
    axes[0].legend(frameon=False, fontsize=9)
    fig.suptitle(
        "Settled share by note age (cross-sectional; older notes are earlier cohorts, so era effects mix in)", y=1.02
    )
    fig.tight_layout()
    fig.savefig(os.path.join(OUT_DIR, "settling_over_time.png"), dpi=160, bbox_inches="tight")
    plt.close(fig)


def fit_and_report(name, formula, data, tier_block_reduced=None):
    model = smf.logit(formula, data=data).fit(disp=0)
    print(f"\n── {name}")
    print(f"   n={int(model.nobs)}  formula: {formula}")
    conf = model.conf_int()
    for param in model.params.index:
        if param == "Intercept":
            continue
        odds = math.exp(model.params[param])
        lo, hi = math.exp(conf.loc[param, 0]), math.exp(conf.loc[param, 1])
        print(f"   {param:<42} OR {odds:6.3f}  [{lo:.3f}, {hi:.3f}]  p={model.pvalues[param]:.4f}")
    if tier_block_reduced:
        reduced = smf.logit(tier_block_reduced, data=data).fit(disp=0)
        lr_stat = 2 * (model.llf - reduced.llf)
        df_diff = int(model.df_model - reduced.df_model)
        from scipy.stats import chi2

        p = chi2.sf(lr_stat, df_diff)
        print(f"   LR test for the tier block: chi2={lr_stat:.2f}, df={df_diff}, p={p:.4f}")
    return model


def run_models(frame):
    sub = eligible_submitted(frame).copy()
    sub["log_age"] = np.log(sub["days_since_submission"])
    settled = sub[sub["settled"].astype(bool)].copy()

    fit_and_report(
        "H1: P(helpful | settled) ~ tier + log10(velocity) + era",
        "helpful ~ C(tier, Treatment('large')) + logvel + C(era3, Treatment('5k floor'))",
        settled,
        tier_block_reduced="helpful ~ logvel + C(era3, Treatment('5k floor'))",
    )
    fit_and_report(
        "H1 interaction (flagged underpowered): tier × log10(velocity)",
        "helpful ~ C(tier, Treatment('large')) * logvel + C(era3, Treatment('5k floor'))",
        settled,
    )
    fit_and_report(
        "H2: P(settled | submitted) ~ tier + log10(velocity) + era + log(age)",
        "settled ~ C(tier, Treatment('large')) + logvel + C(era3, Treatment('5k floor')) + log_age",
        sub,
        tier_block_reduced="settled ~ logvel + C(era3, Treatment('5k floor')) + log_age",
    )


def sensitivity_table(frame):
    print(f"\n── settlement-horizon sensitivity: {SETTLE_DAYS}d vs {SETTLE_DAYS_SENSITIVITY}d cohorts")
    print(f"{'tier':<7}{'horizon':>8}{'n':>7}{'settled':>9}{'pH|settled':>12}{'pU|settled':>12}")
    for tier in REGULAR_TIERS:
        for days in (SETTLE_DAYS, SETTLE_DAYS_SENSITIVITY):
            sub = eligible_submitted(frame, days)
            sub = sub[sub["tier"] == tier]
            settled = sub[sub["settled"].astype(bool)]
            n_settled = len(settled)
            ph = settled["helpful"].mean() if n_settled else float("nan")
            print(
                f"{tier:<7}{days:>7}d{len(sub):>7}{n_settled:>9}{ph:>11.1%} {1 - ph if n_settled else float('nan'):>11.1%}"
            )


def main():
    frame = load_frame()
    main_figure(frame)
    era_figure(frame)
    settling_figure(frame)
    print("wrote helpful_unhelpful_by_tier.png, epoch_stability.png, settling_over_time.png")
    run_models(frame)
    sensitivity_table(frame)


if __name__ == "__main__":
    main()
