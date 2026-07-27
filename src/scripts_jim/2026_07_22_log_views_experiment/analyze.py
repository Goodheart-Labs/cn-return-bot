"""Log-growth experiment: does V(t) = a*ln(1+t) pinned at the DB snapshot
predict a tweet's current view count?

Per tweet we have two datapoints:
  snapshot: (t1 = age at snapshot in hours, V1 = impressions in the table)
  current:  (t2 = age now in hours,         V2 = impressions from the X API)

The log model through (0,0) pinned at the snapshot: pred = V1 * ln(1+t2)/ln(1+t1).
Baselines pinned the same way: frozen (V1), sqrt (V1*sqrt(t2/t1)), linear (V1*t2/t1).

Follow-up: is there a snapshot velocity (V1/t1, only for tweets whose snapshot
was taken early, t1 <= MAX_SNAPSHOT_AGE_H) above which the log model predicts well?

Run from workspace root:
  source .venv/bin/activate && python3 src/scripts_jim/2026_07_22_log_views_experiment/analyze.py
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).parent / "data"
PLOT_DIR = Path(__file__).parent / "plots"
RESULTS_PATH = Path(__file__).parent / "RESULTS.md"

GROUPS = ["small_feed", "large_feed", "xxl_dump"]
GROUP_COLORS = {"small_feed": "#2a78d6", "large_feed": "#eb6834", "xxl_dump": "#1baf7a"}
MODELS = ["log", "frozen", "sqrt", "linear"]
MODEL_COLORS = {"log": "#2a78d6", "frozen": "#eb6834", "sqrt": "#1baf7a", "linear": "#eda100"}

# Headline metrics only use tweets that still had meaningful growing time left:
# with t2/t1 near 1 every model trivially predicts "no change".
MIN_GAP_RATIO = 1.5
# Velocity is only meaningful if the snapshot was taken early in the tweet's life.
MAX_SNAPSHOT_AGE_H = 48.0
WITHIN_2X_TARGET = 0.70

TEXT = "#333333"
GRID = "#e8e8e8"

plt.rcParams.update({
    "figure.facecolor": "white", "axes.facecolor": "white",
    "axes.edgecolor": GRID, "axes.labelcolor": TEXT, "text.color": TEXT,
    "xtick.color": TEXT, "ytick.color": TEXT,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.spines.top": False, "axes.spines.right": False,
    "font.size": 10,
})


def load_group(group: str) -> pd.DataFrame:
    df = pd.read_csv(DATA_DIR / f"{group}.csv", dtype={"tweet_id": str})
    for col in ("posted_at", "snapshot_at", "current_at"):
        df[col] = pd.to_datetime(df[col], utc=True, format="ISO8601")
    df["t1_h"] = (df.snapshot_at - df.posted_at).dt.total_seconds() / 3600
    df["t2_h"] = (df.current_at - df.posted_at).dt.total_seconds() / 3600
    df["V1"] = df.snapshot_impressions.astype(float)
    df["V2"] = df.current_impressions.astype(float)
    n_raw = len(df)
    df = df[(df.t1_h > 0) & (df.t2_h > df.t1_h) & (df.V1 > 0) & (df.V2 > 0)].copy()
    df["group"] = group
    df["gap_ratio"] = df.t2_h / df.t1_h
    df["velocity"] = df.V1 / df.t1_h  # impressions/hour at snapshot

    df["pred_log"] = df.V1 * np.log1p(df.t2_h) / np.log1p(df.t1_h)
    df["pred_frozen"] = df.V1
    df["pred_sqrt"] = df.V1 * np.sqrt(df.gap_ratio)
    df["pred_linear"] = df.V1 * df.gap_ratio
    for m in MODELS:
        df[f"err_{m}"] = np.log10(df[f"pred_{m}"] / df.V2)  # signed log10 error
    print(f"[analyze] {group}: {n_raw} rows -> {len(df)} usable")
    return df


def metrics(err: pd.Series) -> dict:
    ae = err.abs()
    return {
        "n": len(err),
        "median_abs_log10": ae.median(),
        "within_2x": (ae <= np.log10(2)).mean(),
        "within_1.26x": (ae <= 0.1).mean(),
        "median_signed": err.median(),
    }


def fmt_metrics_table(df: pd.DataFrame, label: str) -> list[str]:
    lines = [f"**{label}** (n={len(df)})", "",
             "| model | median error (×) | within 2× | within 1.26× | bias |",
             "|---|---|---|---|---|"]
    for m in MODELS:
        s = metrics(df[f"err_{m}"])
        bias_x = 10 ** s["median_signed"]
        lines.append(
            f"| {m} | {10 ** s['median_abs_log10']:.2f}× | {s['within_2x']:.0%} "
            f"| {s['within_1.26x']:.0%} | {'over' if bias_x > 1 else 'under'}-predicts ×{max(bias_x, 1 / bias_x):.2f} |")
    lines.append("")
    return lines


def plot_pred_vs_actual(dfs: dict[str, pd.DataFrame]) -> None:
    fig, axes = plt.subplots(1, 3, figsize=(15, 5), sharex=False, sharey=False)
    for ax, group in zip(axes, GROUPS):
        df = dfs[group]
        d = df[df.gap_ratio >= MIN_GAP_RATIO]
        lo, hi = 1e2, max(d.V2.max(), d.pred_log.max()) * 1.5 if len(d) else 1e8
        ax.fill_between([lo, hi], [lo / 2, hi / 2], [lo * 2, hi * 2], color=GRID, alpha=0.6, lw=0, label="within 2×")
        ax.plot([lo, hi], [lo, hi], color=TEXT, lw=1)
        ax.scatter(d.V2, d.pred_log, s=9, color=GROUP_COLORS[group], alpha=0.45, lw=0)
        ax.set_xscale("log"); ax.set_yscale("log")
        ax.set_xlim(lo, hi); ax.set_ylim(lo, hi)
        ax.set_title(f"{group} (n={len(d)}, gap ≥ {MIN_GAP_RATIO}×)", color=TEXT)
        ax.set_xlabel("actual current views")
    axes[0].set_ylabel("log-model predicted views")
    axes[0].legend(frameon=False, loc="upper left")
    fig.suptitle("Log model: predicted vs actual current views", color=TEXT)
    fig.tight_layout()
    fig.savefig(PLOT_DIR / "pred_vs_actual.png", dpi=150)
    plt.close(fig)


def plot_error_distributions(dfs: dict[str, pd.DataFrame]) -> None:
    fig, axes = plt.subplots(1, 3, figsize=(15, 4.5), sharey=True)
    bins = np.linspace(-1.5, 1.5, 61)
    for ax, group in zip(axes, GROUPS):
        d = dfs[group]
        d = d[d.gap_ratio >= MIN_GAP_RATIO]
        for m in MODELS:
            ax.hist(d[f"err_{m}"].clip(-1.5, 1.5), bins=bins, histtype="step",
                    lw=1.8, color=MODEL_COLORS[m], label=m, density=True)
        ax.axvline(0, color=TEXT, lw=0.8)
        ax.set_title(f"{group} (n={len(d)})", color=TEXT)
        ax.set_xlabel("log10(predicted / actual)")
    axes[0].set_ylabel("density")
    axes[0].legend(frameon=False)
    fig.suptitle("Signed prediction error by model (0 = perfect, ±0.301 = 2× off)", color=TEXT)
    fig.tight_layout()
    fig.savefig(PLOT_DIR / "error_distributions.png", dpi=150)
    plt.close(fig)


def velocity_curve(df: pd.DataFrame) -> pd.DataFrame:
    d = df[(df.t1_h <= MAX_SNAPSHOT_AGE_H) & (df.gap_ratio >= MIN_GAP_RATIO)].copy()
    if len(d) < 30:
        return pd.DataFrame()
    edges = [0, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000, 125_000, 250_000, np.inf]
    d["vbin"] = pd.cut(d.velocity, edges, right=False)
    rows = []
    for interval, g in d.groupby("vbin", observed=True):
        if len(g) < 8:
            continue
        rows.append({
            "bin_left": interval.left, "bin_right": interval.right, "n": len(g),
            "median_abs": g.err_log.abs().median(),
            "within_2x": (g.err_log.abs() <= np.log10(2)).mean(),
        })
    return pd.DataFrame(rows)


def velocity_threshold(df: pd.DataFrame) -> tuple[float, float] | None:
    """Smallest velocity v* with >=WITHIN_2X_TARGET of tweets at velocity>=v* within 2x."""
    d = df[(df.t1_h <= MAX_SNAPSHOT_AGE_H) & (df.gap_ratio >= MIN_GAP_RATIO)]
    for v in [0, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000, 125_000, 250_000]:
        g = d[d.velocity >= v]
        if len(g) < 30:
            break
        frac = (g.err_log.abs() <= np.log10(2)).mean()
        if frac >= WITHIN_2X_TARGET:
            return v, frac
    return None


def plot_velocity(dfs: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    curves = {}
    fig, ax = plt.subplots(figsize=(8, 5))
    for group in GROUPS:
        curve = velocity_curve(dfs[group])
        curves[group] = curve
        if curve.empty:
            continue
        x = np.sqrt(curve.bin_left.clip(lower=250) * curve.bin_right.replace(np.inf, 500_000))
        ax.plot(x, curve.within_2x, marker="o", ms=5, lw=1.8,
                color=GROUP_COLORS[group], label=f"{group} (n={int(curve.n.sum())})")
    ax.axhline(WITHIN_2X_TARGET, color=TEXT, lw=0.8, ls="--")
    ax.annotate(f"{WITHIN_2X_TARGET:.0%} target", xy=(0.99, WITHIN_2X_TARGET), xycoords=("axes fraction", "data"),
                ha="right", va="bottom", fontsize=9)
    ax.set_xscale("log")
    ax.set_ylim(0, 1)
    ax.set_xlabel(f"velocity at snapshot (impressions/hour, snapshot ≤ {MAX_SNAPSHOT_AGE_H:.0f}h old)")
    ax.set_ylabel("share of log-model predictions within 2×")
    ax.set_title("Does higher early velocity make the log model reliable?", color=TEXT)
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(PLOT_DIR / "velocity_vs_accuracy.png", dpi=150)
    plt.close(fig)
    return curves


C_SWEEP_HOURS = [0.1, 0.3, 1.0, 3.0, 10.0, 24.0, 72.0, 240.0]


def sweep_time_constant(df: pd.DataFrame) -> list[tuple[float, float, float]]:
    """(0,0) + one point does NOT pin V = a*ln(1+t/c): the origin holds for every
    (a, c). We fix c by convention (1h) in the main tables; here the second point
    of every tweet picks the best-fitting global c instead."""
    d = df[df.gap_ratio >= MIN_GAP_RATIO]
    out = []
    for c in C_SWEEP_HOURS:
        err = np.log10((d.V1 * np.log1p(d.t2_h / c) / np.log1p(d.t1_h / c)) / d.V2)
        out.append((c, 10 ** err.abs().median(), (err.abs() <= np.log10(2)).mean()))
    return out


def main() -> None:
    PLOT_DIR.mkdir(exist_ok=True)
    dfs = {g: load_group(g) for g in GROUPS}

    lines = ["# Log-growth prediction experiment", "",
             f"Model: V(t) = a·ln(1+t_hours), pinned through (0,0) and the DB snapshot "
             f"(t1, V1); predict current views V2 at age t2. Baselines pinned identically. "
             f"Headline tables restrict to tweets with t2/t1 ≥ {MIN_GAP_RATIO} — below that every "
             f"model trivially says 'unchanged'.", ""]

    for group in GROUPS:
        df = dfs[group]
        d = df[df.gap_ratio >= MIN_GAP_RATIO]
        lines += [f"## {group}", ""]
        lines += fmt_metrics_table(d, f"gap ≥ {MIN_GAP_RATIO}×")
        lines += fmt_metrics_table(df, "all usable rows")

    lines += ["## Time-constant sweep", "",
              "V = a·ln(1+t/c) is NOT pinned by (0,0) + one point — the origin holds for every "
              "(a, c). The main tables fix c = 1h by convention; this sweep uses each tweet's "
              "second point to find the best global c.", "",
              "| c (hours) | " + " | ".join(GROUPS) + " |",
              "|---|" + "---|" * len(GROUPS)]
    sweeps = {g: sweep_time_constant(dfs[g]) for g in GROUPS}
    for i, c in enumerate(C_SWEEP_HOURS):
        cells = [f"×{sweeps[g][i][1]:.2f}, {sweeps[g][i][2]:.0%} in 2×" for g in GROUPS]
        lines.append(f"| {c:g} | " + " | ".join(cells) + " |")
    lines.append("")

    lines += ["## Velocity follow-up", "",
              f"Velocity = V1/t1 (impressions/hour at snapshot), only tweets whose snapshot was "
              f"taken at age ≤ {MAX_SNAPSHOT_AGE_H:.0f}h and gap ≥ {MIN_GAP_RATIO}×.", ""]
    plot_pred_vs_actual(dfs)
    plot_error_distributions(dfs)
    curves = plot_velocity(dfs)
    for group in GROUPS:
        thr = velocity_threshold(dfs[group])
        if curves[group].empty:
            lines.append(f"- **{group}**: not enough early-snapshot tweets for the velocity analysis")
        elif thr is None:
            lines.append(f"- **{group}**: no velocity threshold reaches {WITHIN_2X_TARGET:.0%} within-2×")
        else:
            lines.append(f"- **{group}**: velocity ≥ {thr[0]:,.0f}/h → {thr[1]:.0%} of predictions within 2×")
    lines += ["", "Plots: `plots/pred_vs_actual.png`, `plots/error_distributions.png`, "
              "`plots/velocity_vs_accuracy.png`", ""]

    RESULTS_PATH.write_text("\n".join(lines))
    print(f"[analyze] wrote {RESULTS_PATH}")
    for group in GROUPS:
        d = dfs[group][dfs[group].gap_ratio >= MIN_GAP_RATIO]
        if len(d):
            s = metrics(d.err_log)
            print(f"[analyze] {group}: log model median ×{10 ** s['median_abs_log10']:.2f}, "
                  f"within 2× {s['within_2x']:.0%} (n={s['n']})")


if __name__ == "__main__":
    main()
