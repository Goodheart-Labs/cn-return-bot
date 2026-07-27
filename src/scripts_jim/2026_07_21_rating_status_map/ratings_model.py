"""
Shared pieces for the rating-count → note-outcome investigation: the sample, the
binning of observed rates, cross-validated logistic fitting, and chart styling.

Imported by plot_map.py (the raw plane), fit_helpful.py (2-D model) and
fit_ratings_only.py (1-D model), which otherwise duplicated all of it.
"""
import json
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap
from scipy.optimize import minimize
from scipy.special import expit
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold

HERE = Path(__file__).resolve().parent
HELPFUL, NOT_HELPFUL = "CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL"
DECIDED = {HELPFUL, NOT_HELPFUL}

MIN_NOTES_PER_BIN = 8
RATING_BIN_EDGES = np.array([1, 3, 6, 12, 25, 50, 100, 200, 400, 800, 3000])
SHARE_BIN_EDGES = np.linspace(0, 1, 11)
CV_FOLDS = 5
RANDOM_SEED = 0
WILSON_Z = 1.96   # 95% interval
ML_RANDOM_STARTS = 5
ML_STARTS_SEED = 0
PROBABILITY_CLIP = 1e-9

# dataviz reference palette: sequential blue, steps 100 → 700.
BLUE_RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
SEQ = LinearSegmentedColormap.from_list("seq_blue", BLUE_RAMP)
INK, INK_MUTED, GRID = "#1a1a18", "#6b6b66", "#e3e2de"
STATUS_COLOR = {HELPFUL: "#0ca30c", NOT_HELPFUL: "#d63030", "NEEDS_MORE_RATINGS": "#b9b8b3"}


def load_notes(exclude_not_helpful: bool = False) -> list[dict]:
    """
    One dict per note: total ratings, helpful share, status.

    Notes whose only ratings are somewhat-helpful are dropped — helpful share is
    undefined for them. `exclude_not_helpful` conditions the sample on "not rated
    unhelpful", the denominator the helpful models are fitted against.
    """
    notes = []
    for row in json.loads((HERE / "ratings_status.json").read_text()):
        helpful, not_helpful = row["helpful_count"], row["not_helpful_count"]
        if helpful + not_helpful == 0:
            continue
        if exclude_not_helpful and row["cn_status"] == NOT_HELPFUL:
            continue
        notes.append({
            "ratings": helpful + row["somewhat_helpful_count"] + not_helpful,
            "helpful_share": helpful / (helpful + not_helpful),
            "status": row["cn_status"],
            "helpful": int(row["cn_status"] == HELPFUL),
            "decided": int(row["cn_status"] in DECIDED),
        })
    return notes


def rating_bin_index(ratings: float) -> int:
    return min(int(np.searchsorted(RATING_BIN_EDGES, ratings, side="right")) - 1, len(RATING_BIN_EDGES) - 2)


def bin_center(edges: np.ndarray, index: int, geometric: bool) -> float:
    lo, hi = edges[index], edges[index + 1]
    return float(np.sqrt(lo * hi)) if geometric else float((lo + hi) / 2)


def wilson_interval(successes: int, total: int) -> tuple[float, float]:
    """95% Wilson score interval — behaves at the 0% and 100% bins, unlike Wald."""
    rate = successes / total
    denominator = 1 + WILSON_Z**2 / total
    center = (rate + WILSON_Z**2 / (2 * total)) / denominator
    half = WILSON_Z / denominator * np.sqrt(rate * (1 - rate) / total + WILSON_Z**2 / (4 * total**2))
    return max(center - half, 0.0), min(center + half, 1.0)


def bin_binary(values: np.ndarray, outcomes: np.ndarray, edges: np.ndarray) -> list[dict]:
    """Observed rate of a 0/1 outcome per log-spaced bin of `values`, with a Wilson interval."""
    cells = defaultdict(list)
    for value, outcome in zip(values, outcomes):
        index = min(int(np.searchsorted(edges, value, side="right")) - 1, len(edges) - 2)
        cells[max(index, 0)].append(outcome)
    bins = []
    for index, members in sorted(cells.items()):
        if len(members) < MIN_NOTES_PER_BIN:
            continue
        low, high = wilson_interval(int(sum(members)), len(members))
        bins.append({
            "x": bin_center(edges, index, geometric=True),
            "lo_edge": float(edges[index]),
            "hi_edge": float(edges[index + 1]),
            "count": len(members),
            "rate": float(np.mean(members)),
            "ci_low": low,
            "ci_high": high,
        })
    return bins


def bin_by_ratings(notes: list[dict], outcome: str) -> list[dict]:
    """Observed rate of `outcome` per rating-count bin, with a Wilson interval."""
    return bin_binary(np.array([n["ratings"] for n in notes]),
                      np.array([n[outcome] for n in notes]), RATING_BIN_EDGES)


def bin_by_plane(notes: list[dict], outcome: str) -> list[dict]:
    """Observed rate of `outcome` per (rating count, helpful share) cell."""
    cells = defaultdict(list)
    for note in notes:
        share_index = min(int(note["helpful_share"] * (len(SHARE_BIN_EDGES) - 1)), len(SHARE_BIN_EDGES) - 2)
        cells[(rating_bin_index(note["ratings"]), share_index)].append(note[outcome])
    return [
        {
            "x": bin_center(RATING_BIN_EDGES, x, geometric=True),
            "y": bin_center(SHARE_BIN_EDGES, y, geometric=False),
            "count": len(members),
            "rate": float(np.mean(members)),
        }
        for (x, y), members in cells.items()
        if len(members) >= MIN_NOTES_PER_BIN
    ]


def design_matrix(terms: list, ratings: np.ndarray, shares: np.ndarray | None = None) -> np.ndarray:
    log_ratings = np.log10(ratings)
    return np.column_stack([build(log_ratings, shares) for _, build in terms])


def fit_logistic(features: np.ndarray, labels: np.ndarray):
    """Fit a logistic regression; return its predict-probability function."""
    model = LogisticRegression(max_iter=1000).fit(features, labels)
    return lambda unseen: model.predict_proba(unseen)[:, 1]


def cross_validated_predictions(features: np.ndarray, labels: np.ndarray, fit=fit_logistic) -> np.ndarray:
    """
    Out-of-fold P(outcome) for every note, so every metric is held out.

    `fit(features, labels) -> predict(features) -> probabilities`, so model families
    that aren't logistic regressions (see fit_overshoot.py) are scored on exactly
    the same folds and are therefore directly comparable.
    """
    predictions = np.zeros(len(labels))
    folds = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_SEED)
    for train, test in folds.split(features, labels):
        predictions[test] = fit(features[train], labels[train])(features[test])
    return predictions


def two_logistics_probability(theta: np.ndarray, x: np.ndarray) -> np.ndarray:
    """Overshoot-and-settle: A·σ(a(x−p)) − B·σ(b(x−q)) with B = A·fraction, plateau A−B."""
    amplitude, rise_slope, rise_center, drop_fraction, drop_slope, drop_center = theta
    curve = amplitude * (expit(rise_slope * (x - rise_center))
                         - drop_fraction * expit(drop_slope * (x - drop_center)))
    return np.clip(curve, PROBABILITY_CLIP, 1 - PROBABILITY_CLIP)


def make_two_logistics_family(x_low: float, x_high: float) -> dict:
    """The two-logistics family with both transition centers bounded to the data's x range."""
    span = x_high - x_low
    return {
        "probability": two_logistics_probability,
        "initial": np.array([0.35, 5.0, x_low + 0.3 * span, 0.9, 3.0, x_low + 0.6 * span]),
        "bounds": [(1e-3, 1.0), (0.1, 30.0), (x_low, x_high),
                   (0.0, 1.0), (0.1, 30.0), (x_low, x_high)],
    }


def fit_ml_family(family: dict, x: np.ndarray, labels: np.ndarray) -> np.ndarray:
    """
    Maximum-likelihood fit of a parametric probability family.

    The likelihoods are non-convex — single starts occasionally land in bad
    optima — so each fit tries the family's hand-picked start plus a few seeded
    random ones and keeps the best. Deterministic across runs.
    """
    def negative_log_likelihood(theta):
        probability = family["probability"](theta, x)
        return -np.sum(labels * np.log(probability) + (1 - labels) * np.log(1 - probability))

    rng = np.random.default_rng(ML_STARTS_SEED)
    starts = [family["initial"]] + [np.array([rng.uniform(lo, hi) for lo, hi in family["bounds"]])
                                    for _ in range(ML_RANDOM_STARTS)]
    fits = [minimize(negative_log_likelihood, start, bounds=family["bounds"], method="L-BFGS-B")
            for start in starts]
    return min(fits, key=lambda fit: fit.fun).x


def ml_family_cv_fit(family: dict):
    """Adapter so fit_ml_family plugs into cross_validated_predictions (single-column features)."""
    def fit(features: np.ndarray, labels: np.ndarray):
        theta = fit_ml_family(family, features[:, 0], labels)
        return lambda unseen: family["probability"](theta, unseen[:, 0])
    return fit


def marker_area(count: int) -> float:
    return 28 + 9 * np.sqrt(count)


def style_axes(ax, title: str, subtitle: str) -> None:
    ax.tick_params(colors=INK_MUTED, labelsize=8, length=0)
    ax.grid(True, color=GRID, linewidth=0.7)
    ax.set_axisbelow(True)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_title(title, color=INK, fontsize=12, fontweight="bold", loc="left", pad=20)
    ax.text(0, 1.02, subtitle, transform=ax.transAxes, color=INK_MUTED, fontsize=8.5, va="bottom")


def style_ratings_axis(ax, label: str = "Ratings on the note") -> None:
    ax.set_xscale("log")
    ax.set_xlim(1.5, 3000)
    ax.set_xticks([2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500])
    ax.get_xaxis().set_major_formatter(plt.ScalarFormatter())
    ax.set_xlabel(label, color=INK_MUTED, fontsize=9)


def percent_axis(ax, axis: str, label: str) -> None:
    ticks = np.arange(0, 1.01, 0.25)
    setter = ax.set_yticks if axis == "y" else ax.set_xticks
    labeller = ax.set_yticklabels if axis == "y" else ax.set_xticklabels
    setter(ticks)
    labeller([f"{v:.0%}" for v in ticks])
    (ax.set_ylabel if axis == "y" else ax.set_xlabel)(label, color=INK_MUTED, fontsize=9)


def colorbar(fig, mappable, ax, label: str = "", horizontal: bool = False) -> None:
    bar = fig.colorbar(mappable, ax=ax, pad=0.13 if horizontal else 0.02,
                       **({"orientation": "horizontal", "location": "bottom",
                           "fraction": 0.05, "aspect": 45} if horizontal else {}))
    ticks = np.arange(0, 1.01, 0.25)
    bar.set_ticks(ticks)
    (bar.ax.set_xticklabels if horizontal else bar.ax.set_yticklabels)([f"{v:.0%}" for v in ticks])
    bar.ax.tick_params(colors=INK_MUTED, labelsize=8, length=0)
    bar.outline.set_visible(False)
    if label:
        bar.set_label(label, color=INK_MUTED, fontsize=9)
