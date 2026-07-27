"""Fair re-analysis of the log-growth experiment.

v1's within-2x compared groups on raw accuracy, which conflates model quality
with task difficulty: xxl_dump extrapolates ~5x past its snapshot while
small/large extrapolate 100-200x, so xxl scored 95% "within 2x" by barely
predicting anything. Three difficulty-normalized views instead:

1. SKILL vs the frozen baseline: 1 - MSE(log)/MSE(frozen) in log10 space.
   Positive = the log model beats assuming zero growth on that group's task.
2. ERROR PER DEX of extrapolation: |log10 err| / log10(t2/t1) — error per unit
   of task; comparable across groups, and binned by view magnitude to test
   whether low-count tweets are intrinsically noisier (the magnitude critique).
3. SHAPE TEST (non-parametric, pooled): each tweet's empirical growth
   elasticity b = log(V2/V1)/log(t2/t1) vs the log-law prediction at its age.
   No groups, no pinning convention — just "does growth bend like ln(t)?"

Run from workspace root:
  source .venv/bin/activate && python3 src/scripts_jim/2026_07_22_log_views_experiment/analyze2.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from analyze import GROUP_COLORS, GROUPS, MIN_GAP_RATIO, PLOT_DIR, load_group

RESULTS_PATH = Path(__file__).parent / "RESULTS2.md"
BEST_C_HOURS = 0.3  # empirical winner of the v1 time-constant sweep
TEXT = "#333333"


def prepare(g: str) -> pd.DataFrame:
    d = load_group(g)
    d = d[d.gap_ratio >= MIN_GAP_RATIO].copy()
    d["G"] = np.log10(d.V2 / d.V1)                     # actual log-growth (dex)
    d["Ghat"] = np.log10(np.log1p(d.t2_h / BEST_C_HOURS) / np.log1p(d.t1_h / BEST_C_HOURS))
    d["e_log"] = d.Ghat - d.G                          # signed log10 error, c=0.3h model
    d["e_frozen"] = -d.G                               # frozen predicts zero growth
    d["dex"] = np.log10(d.gap_ratio)                   # extrapolation distance in dex
    d["e_per_dex"] = d.e_log.abs() / d.dex
    d["b_emp"] = d.G / d.dex                           # empirical growth elasticity
    d["b_pred"] = d.Ghat / d.dex                       # log-law elasticity at this age
    d["t_mid_h"] = np.sqrt(d.t1_h * d.t2_h)            # interval midpoint (geometric)
    return d


def skill_row(d: pd.DataFrame) -> dict:
    mse_log, mse_frozen = (d.e_log ** 2).mean(), (d.e_frozen ** 2).mean()
    return {
        "n": len(d),
        "rmse_log": np.sqrt(mse_log),
        "rmse_frozen": np.sqrt(mse_frozen),
        "skill": 1 - mse_log / mse_frozen,
        "r2_growth": np.corrcoef(d.Ghat, d.G)[0, 1] ** 2 if len(d) > 2 else np.nan,
        "med_e_per_dex": d.e_per_dex.median(),
    }


def plot_shape_test(pooled: pd.DataFrame) -> pd.DataFrame:
    """Median empirical elasticity by age vs the log-law curve."""
    d = pooled[pooled.t_mid_h > 0].copy()
    edges = np.geomspace(d.t_mid_h.min() * 0.99, d.t_mid_h.max() * 1.01, 14)
    d["abin"] = pd.cut(d.t_mid_h, edges)
    rows = []
    for interval, g in d.groupby("abin", observed=True):
        if len(g) < 25:
            continue
        rows.append({
            "t_mid_h": np.sqrt(interval.left * interval.right), "n": len(g),
            "b_emp_med": g.b_emp.median(),
            "b_emp_lo": g.b_emp.quantile(0.25), "b_emp_hi": g.b_emp.quantile(0.75),
            "b_pred_med": g.b_pred.median(),
        })
    curve = pd.DataFrame(rows)

    fig, ax = plt.subplots(figsize=(9, 5.5))
    for g in GROUPS:
        s = d[d.group == g]
        ax.scatter(s.t_mid_h, s.b_emp, s=6, alpha=0.15, lw=0, color=GROUP_COLORS[g], label=None)
    ax.fill_between(curve.t_mid_h, curve.b_emp_lo, curve.b_emp_hi, color="#bbbbbb", alpha=0.35, lw=0, label="empirical IQR")
    ax.plot(curve.t_mid_h, curve.b_emp_med, color=TEXT, lw=2.2, marker="o", ms=4, label="empirical median")
    ax.plot(curve.t_mid_h, curve.b_pred_med, color="#e34948", lw=2, ls="--", label=f"log law, c={BEST_C_HOURS}h")
    ax.set_xscale("log")
    ax.set_ylim(-0.3, 1.0)
    ax.axhline(0, color=TEXT, lw=0.7)
    ax.set_xlabel("tweet age (hours, geometric midpoint of the two datapoints)")
    ax.set_ylabel("growth elasticity  b = Δlog(views) / Δlog(age)")
    ax.set_title("Shape test: does view growth bend like ln(t)?  (all groups pooled)", color=TEXT)
    handles, labels = ax.get_legend_handles_labels()
    for g in GROUPS:
        handles.append(plt.Line2D([], [], marker="o", ls="", color=GROUP_COLORS[g], ms=6))
        labels.append(g)
    ax.legend(handles, labels, frameon=False, loc="upper right")
    fig.tight_layout()
    fig.savefig(PLOT_DIR / "shape_test.png", dpi=150)
    plt.close(fig)
    return curve


def plot_fairness(pooled: pd.DataFrame) -> pd.DataFrame:
    """|error| per dex of extrapolation, by view magnitude and by group."""
    d = pooled.copy()
    d["v1bin"] = pd.cut(np.log10(d.V1), [2, 3, 4, 5, 6, 8])
    mag = d.groupby("v1bin", observed=True).agg(
        n=("e_per_dex", "size"), med=("e_per_dex", "median")).reset_index()

    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    ax = axes[0]
    for g in GROUPS:
        s = d[d.group == g]
        m = s.groupby("v1bin", observed=True).e_per_dex.agg(["median", "size"]).reset_index()
        m = m[m["size"] >= 15]
        x = [10 ** ((iv.left + iv.right) / 2) for iv in m.v1bin]
        ax.plot(x, m["median"], marker="o", ms=5, lw=1.8, color=GROUP_COLORS[g], label=g)
    ax.set_xscale("log")
    ax.set_xlabel("views at snapshot (V1)")
    ax.set_ylabel("median |log10 error| per dex extrapolated")
    ax.set_title("Does view magnitude drive error? (difficulty-normalized)", color=TEXT)
    ax.legend(frameon=False)

    ax = axes[1]
    for g in GROUPS:
        s = d[d.group == g].copy()
        s["dbin"] = pd.cut(s.dex, [0.17, 0.5, 1.0, 1.5, 2.0, 3.0, 4.5])
        m = s.groupby("dbin", observed=True).e_log.agg(lambda x: x.abs().median()).reset_index(name="med")
        cnt = s.dbin.value_counts().sort_index()
        m = m[[cnt.get(b, 0) >= 15 for b in m.dbin]]
        x = [(iv.left + iv.right) / 2 for iv in m.dbin]
        ax.plot(x, m["med"], marker="o", ms=5, lw=1.8, color=GROUP_COLORS[g], label=g)
    ax.set_xlabel("extrapolation distance log10(t2/t1) (dex)")
    ax.set_ylabel("median |log10 error|")
    ax.set_title("Error grows with extrapolation distance", color=TEXT)
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(PLOT_DIR / "fairness.png", dpi=150)
    plt.close(fig)
    return mag


def main() -> None:
    PLOT_DIR.mkdir(exist_ok=True)
    dfs = {g: prepare(g) for g in GROUPS}
    pooled = pd.concat(dfs.values(), ignore_index=True)

    lines = ["# Fair re-analysis (v2)", "",
             "v1's within-2x horse race conflated model quality with task difficulty "
             "(xxl extrapolates ~5x past its snapshot; small/large 100-200x). "
             f"All numbers below use the empirically best time constant c={BEST_C_HOURS}h.", "",
             "## Skill vs the frozen baseline (log10 space, gap >= 1.5x)", "",
             "skill = 1 - MSE(log model)/MSE(frozen). Positive = predicting log growth "
             "beats predicting no growth on that group's own task.", "",
             "| group | n | RMSE log | RMSE frozen | skill | R2 (growth) | med \\|err\\|/dex |",
             "|---|---|---|---|---|---|---|"]
    for g in GROUPS + ["POOLED"]:
        d = pooled if g == "POOLED" else dfs[g]
        s = skill_row(d)
        lines.append(f"| {g} | {s['n']} | {s['rmse_log']:.3f} | {s['rmse_frozen']:.3f} "
                     f"| {s['skill']:+.2f} | {s['r2_growth']:.2f} | {s['med_e_per_dex']:.3f} |")
        print(f"[v2] {g:>11}: skill={s['skill']:+.2f}  R2={s['r2_growth']:.2f}  "
              f"|err|/dex={s['med_e_per_dex']:.3f}  (rmse {s['rmse_log']:.3f} vs frozen {s['rmse_frozen']:.3f})")

    curve = plot_shape_test(pooled)
    mag = plot_fairness(pooled)

    lines += ["", "## Shape test (pooled, non-parametric)", "",
              "Empirical growth elasticity b = dlog(views)/dlog(age) vs the log-law curve "
              f"b_pred(t) (c={BEST_C_HOURS}h). `plots/shape_test.png`.", "",
              "| age (h) | n | b empirical (median) | b log-law |", "|---|---|---|---|"]
    for r in curve.itertuples():
        lines.append(f"| {r.t_mid_h:,.0f} | {r.n} | {r.b_emp_med:.3f} | {r.b_pred_med:.3f} |")

    lines += ["", "## View-magnitude check (pooled)", "",
              "Median |log10 error| per dex of extrapolation, by views at snapshot. "
              "`plots/fairness.png`.", "",
              "| V1 range | n | med \\|err\\|/dex |", "|---|---|---|"]
    for r in mag.itertuples():
        lines.append(f"| 10^{r.v1bin.left:g}-10^{r.v1bin.right:g} | {r.n} | {r.med:.3f} |")
    lines.append("")

    RESULTS_PATH.write_text("\n".join(lines))
    print(f"[v2] wrote {RESULTS_PATH}")


if __name__ == "__main__":
    main()
