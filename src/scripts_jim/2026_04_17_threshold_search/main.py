"""
Threshold search over per-note scores in dataset_runs/videos-2026-04-16-1102.

Goal: pick a small set of (score_name, threshold) filters such that submitting only
notes whose every chosen score is >= its threshold maximizes the dataset score.

Two scoring schemes:
  A: helpful = +1, unhelpful note = -1, false positive = -1, missed = -1
  B: helpful = +1, unhelpful note = -1, false positive = -1, missed = -0.5

For each scheme we report best filter using 1, 2, 3, 4, and 5 score features.

Vectorized with numpy so the n=5 search finishes in seconds.
"""

from __future__ import annotations

import json
from itertools import combinations, product
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).resolve().parents[2].parent / "dataset_runs" / "videos-2026-04-16-1102"

SCORE_KEYS = [
    "positiveEvidence",
    "disagreement",
    "helpfulness",
    "sourceQuality",
    "breakingNewsRisk",
    "pedantry",
    "noteNotNeeded",
    "tangentialCorrection",
    "raterVerifiability",
    "overconfidence",
]

THRESHOLD_GRID = [0.0, 0.3, 0.5, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0]


def load_candidates() -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    """Returns (score_matrix [N x F], submit_delta [N], baseline counts)."""

    file_to_label = {
        "note_worthy_correct.json": "true_positive",
        "note_worthy_incorrect.json": "unhelpful_note",
        "non_note_worthy_incorrect.json": "false_positive",
    }

    score_rows: list[list[float]] = []
    labels: list[str] = []
    for fn, label in file_to_label.items():
        rows = json.loads((DATA_DIR / fn).read_text())
        for row in rows:
            if (row.get("outcome") or "") != "candidate":
                continue
            scores = (row.get("logs") or {}).get("scores")
            if not scores:
                continue
            try:
                vec = [float(scores[k]["score"]) for k in SCORE_KEYS]
            except (KeyError, TypeError):
                continue
            score_rows.append(vec)
            labels.append(label)

    not_proposed = json.loads((DATA_DIR / "note_worthy_not_proposed.json").read_text())
    nnw_correct = json.loads((DATA_DIR / "non_note_worthy_correct.json").read_text())

    baseline = {
        "missed_unchangeable": len(not_proposed),
        "correctly_skipped_unchangeable": len(nnw_correct),
    }

    return np.array(score_rows, dtype=np.float32), np.array(labels), baseline


def submit_skip_arrays(labels: np.ndarray, scheme_missed: float) -> tuple[np.ndarray, np.ndarray]:
    """Per-candidate score deltas if submitted vs if skipped."""
    submit = np.where(labels == "true_positive", 1.0, -1.0)
    skip = np.where(
        labels == "true_positive",
        scheme_missed,
        np.where(labels == "unhelpful_note", scheme_missed, 0.0),
    )
    return submit.astype(np.float32), skip.astype(np.float32)


def search_n_features(
    scores: np.ndarray,
    submit: np.ndarray,
    skip: np.ndarray,
    n_features: int,
) -> tuple[float, tuple[tuple[str, float], ...]]:
    """Brute-force over feature combos and threshold combos, vectorized over candidates."""
    best_score = float("-inf")
    best_filt: tuple[tuple[str, float], ...] = ()

    n_thr = len(THRESHOLD_GRID)
    thr_array = np.array(THRESHOLD_GRID, dtype=np.float32)

    feature_idxs = list(range(len(SCORE_KEYS)))

    for combo in combinations(feature_idxs, n_features):
        sub_scores = scores[:, list(combo)]  # N x F'
        for thr_idxs in product(range(n_thr), repeat=n_features):
            thrs = thr_array[list(thr_idxs)]
            passes = np.all(sub_scores >= thrs, axis=1)
            total = float(np.where(passes, submit, skip).sum())
            if total > best_score:
                best_score = total
                best_filt = tuple((SCORE_KEYS[i], float(thr_array[t])) for i, t in zip(combo, thr_idxs))

    return best_score, best_filt


def filter_breakdown(
    scores: np.ndarray,
    labels: np.ndarray,
    filt: tuple[tuple[str, float], ...],
) -> dict[str, int]:
    if filt:
        idxs = [SCORE_KEYS.index(name) for name, _ in filt]
        thrs = np.array([thr for _, thr in filt], dtype=np.float32)
        passes = np.all(scores[:, idxs] >= thrs, axis=1)
    else:
        passes = np.ones(len(labels), dtype=bool)

    counts = {
        "submitted_helpful": int(((labels == "true_positive") & passes).sum()),
        "submitted_unhelpful": int(((labels == "unhelpful_note") & passes).sum()),
        "submitted_false_pos": int(((labels == "false_positive") & passes).sum()),
        "skipped_truepos_now_missed": int(((labels == "true_positive") & ~passes).sum()),
        "skipped_unhelpful_now_missed": int(((labels == "unhelpful_note") & ~passes).sum()),
        "skipped_false_pos_avoided": int(((labels == "false_positive") & ~passes).sum()),
    }
    return counts


def pct(num: int, denom: int) -> str:
    if denom == 0:
        return "0%"
    return f"{round(100 * num / denom)}%"


def format_report(
    scheme_label: str,
    scheme_missed: float,
    scores: np.ndarray,
    labels: np.ndarray,
    baseline: dict[str, int],
    n_to_results: dict[int, tuple[float, tuple[tuple[str, float], ...]]],
) -> str:
    n_helpful = int((labels == "true_positive").sum())
    n_unhelpful = int((labels == "unhelpful_note").sum())
    n_false_pos = int((labels == "false_positive").sum())

    n_total_noteworthy = n_helpful + n_unhelpful + baseline["missed_unchangeable"]
    n_total_non_noteworthy = n_false_pos + baseline["correctly_skipped_unchangeable"]
    n_total = n_total_noteworthy + n_total_non_noteworthy

    baseline_score = (
        n_helpful * 1.0
        + n_unhelpful * -1.0
        + n_false_pos * -1.0
        + baseline["missed_unchangeable"] * scheme_missed
    )

    lines = []
    lines.append(f"=== Scheme {scheme_label}: helpful=+1, unhelpful=-1, FP=-1, missed={scheme_missed:+g} ===")
    lines.append(f"Dataset: {n_total} tweets ({n_total_noteworthy} noteworthy, {n_total_non_noteworthy} non-noteworthy)")
    lines.append(
        f"Baseline (no threshold filter, submit every candidate): score = {baseline_score:+g}"
    )
    lines.append(
        f"  candidates: helpful={n_helpful}, unhelpful={n_unhelpful}, false_pos={n_false_pos}; "
        f"unchangeable missed={baseline['missed_unchangeable']}, correct skip={baseline['correctly_skipped_unchangeable']}"
    )
    lines.append("")

    for n in sorted(n_to_results):
        candidate_score, filt = n_to_results[n]
        score = candidate_score + baseline["missed_unchangeable"] * scheme_missed
        counts = filter_breakdown(scores, labels, filt)
        filt_str = ", ".join(f"{name} >= {thr:g}" for name, thr in filt)

        nw_correct = counts["submitted_helpful"]
        nw_incorrect = counts["submitted_unhelpful"]
        nw_missed = (
            baseline["missed_unchangeable"]
            + counts["skipped_truepos_now_missed"]
            + counts["skipped_unhelpful_now_missed"]
        )
        nw_total = n_total_noteworthy
        nnw_correct = baseline["correctly_skipped_unchangeable"] + counts["skipped_false_pos_avoided"]
        nnw_incorrect = counts["submitted_false_pos"]
        nnw_total = n_total_non_noteworthy

        overall_correct = nw_correct + nnw_correct
        overall_total = n_total

        lines.append(f"--- Best filter using {n} score(s) ---")
        lines.append(f"  filter: {filt_str}")
        lines.append(f"  dataset score: {score:+g}  (vs baseline {baseline_score:+g}; delta {score - baseline_score:+g})")
        lines.append("")
        lines.append(f"  NOTEWORTHY (ground truth = yes): {nw_total} tweets")
        lines.append(f"    correct:      {nw_correct}/{nw_total} ({pct(nw_correct, nw_total)})  AI judge confirmed note is good")
        lines.append(f"    incorrect:    {nw_incorrect}/{nw_total} ({pct(nw_incorrect, nw_total)})  note proposed but wrong")
        lines.append(f"    not proposed: {nw_missed}/{nw_total} ({pct(nw_missed, nw_total)})  missed entirely")
        lines.append("")
        lines.append(f"  NON-NOTEWORTHY (ground truth = no): {nnw_total} tweets")
        lines.append(f"    correct:      {nnw_correct}/{nnw_total} ({pct(nnw_correct, nnw_total)})  correctly no note")
        lines.append(f"    incorrect:    {nnw_incorrect}/{nnw_total} ({pct(nnw_incorrect, nnw_total)})  false positive")
        lines.append("")
        lines.append(f"  OVERALL: {overall_correct}/{overall_total} ({pct(overall_correct, overall_total)})")
        lines.append("")

    return "\n".join(lines)


def main() -> None:
    scores, labels, baseline = load_candidates()
    print(f"Loaded {len(labels)} candidates with full scores. Score matrix shape: {scores.shape}")
    print(f"Baseline: {baseline}\n", flush=True)

    for scheme_label, scheme_missed in (("A", -1.0), ("B", -0.5), ("C", 0.0)):
        submit, skip = submit_skip_arrays(labels, scheme_missed)
        n_to_results: dict[int, tuple[float, tuple[tuple[str, float], ...]]] = {}
        for n in (1, 2, 3, 4, 5):
            print(f"[scheme {scheme_label}] searching n={n}...", flush=True)
            n_to_results[n] = search_n_features(scores, submit, skip, n)
            print(f"  best: {n_to_results[n][0]:+g} via {n_to_results[n][1]}", flush=True)

        report = format_report(scheme_label, scheme_missed, scores, labels, baseline, n_to_results)
        print()
        print(report)

        out_path = Path(__file__).resolve().parent / f"results_scheme_{scheme_label}.txt"
        out_path.write_text(report)
        print(f"Wrote {out_path}\n", flush=True)


if __name__ == "__main__":
    main()
