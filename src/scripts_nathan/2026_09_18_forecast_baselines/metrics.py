# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scikit-learn"]
# ///
"""Score data/predictions.parquet (written by forecast.py) and write RESULTS.md.

The prose lines at the top of RESULTS.md are hand-written and preserved. The top table
(between the TOP-TABLE markers) and everything below the AUTO marker are regenerated.
Run:  uv run metrics.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
AUTO = "<!-- AUTO-GENERATED BELOW THIS LINE BY metrics.py; edits below are overwritten -->"
TT0, TT1 = "<!-- TOP-TABLE-START (metrics.py) -->", "<!-- TOP-TABLE-END -->"
REF = "prior_30d"
MAIN = ["prior_all", "prior_30d", "eval_only", "stable4", "stable4_no_earlier", "gbm_canary"]
PLATT = ["eval_only_platt", "stable4_platt", "stable4_no_earlier_platt", "gbm_canary_platt"]
TARGETS = ["H", "NH", "rated"]
CLIP = (0.001, 0.999)
N_BOOT, SEED = 2000, 0
FIXED = [0, 0.05, 0.10, 0.15, 0.25, 1.0000001]
FIXED_LAB = ["0-5%", "5-10%", "10-15%", "15-25%", "25%+"]


def wilson(x, n, z=1.959964):
    if n == 0:
        return (np.nan, np.nan)
    p = x / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def cal_slope(p, y):
    """Unpenalised logistic regression of y on logit(p). Returns slope and Wald 95% interval."""
    x = np.log(p / (1 - p))
    if x.std() < 1e-6:
        return np.nan, np.nan, np.nan
    X = np.column_stack([np.ones_like(x), x - x.mean()])
    b = np.array([np.log(y.mean() / (1 - y.mean())), 0.0])
    try:
        for _ in range(100):
            mu = 1 / (1 + np.exp(-(X @ b)))
            Hm = X.T @ (X * (mu * (1 - mu))[:, None])
            step = np.linalg.solve(Hm, X.T @ (y - mu))
            b = b + step
            if np.abs(step).max() < 1e-9:
                break
        se = np.sqrt(np.diag(np.linalg.inv(Hm)))[1]
    except np.linalg.LinAlgError:
        return np.nan, np.nan, np.nan
    return b[1], b[1] - 1.96 * se, b[1] + 1.96 * se


def irls(X, y, offset=None):
    """Unpenalised logistic fit by Newton steps. Returns fitted probabilities."""
    offset = np.zeros(len(y)) if offset is None else offset
    b = np.zeros(X.shape[1])
    for _ in range(100):
        mu = 1 / (1 + np.exp(-(X @ b + offset)))
        step = np.linalg.solve(X.T @ (X * (mu * (1 - mu))[:, None]), X.T @ (y - mu))
        b = b + step
        if np.abs(step).max() < 1e-9:
            break
    return 1 / (1 + np.exp(-(X @ b + offset)))


def f5(x):
    return f"{x:.5f}"


def sgn5(x):
    return f"{x:+.5f}"


def pc(x, d=1):
    return "n/a" if np.isnan(x) else f"{100 * x:.{d}f}%"


def verdict(lo, hi):
    if hi < 0:
        return "yes, better"
    if lo > 0:
        return "yes, worse"
    return "no"


def main():
    meta = json.loads((DATA / "run_meta.json").read_text())
    pred = pd.read_parquet(DATA / "predictions.parquet")
    sc = pred[pred["scored"]].copy()
    sc["p"] = sc["p"].clip(*CLIP)
    fcs = MAIN + PLATT
    wide, ys, days = {}, {}, None
    for tg in TARGETS:
        g = sc[sc["target"] == tg]
        w = g.pivot(index="note_id", columns="forecaster", values="p")[fcs]
        assert not w.isna().any().any(), "every forecaster must cover the identical scored set"
        meta_g = g[g["forecaster"] == REF].set_index("note_id").loc[w.index]
        wide[tg], ys[tg] = w, meta_g["y"].values.astype(float)
        days = meta_g["refit_day"].values
        when = meta_g["submitted_at"]
    n = len(wide["H"])
    assert all(len(wide[t]) == n and (wide[t].index == wide["H"].index).all() for t in TARGETS)

    rng = np.random.default_rng(SEED)
    idx = rng.integers(0, n, size=(N_BOOT, n))                    # note-level resamples, shared by all rows
    uday, dcode = np.unique(days, return_inverse=True)
    didx = rng.integers(0, len(uday), size=(N_BOOT, len(uday)))   # day-block resamples

    rows = []
    for tg in TARGETS:
        y = ys[tg]
        ref = wide[tg][REF].values
        ref_b, ref_ll = (ref - y) ** 2, -(y * np.log(ref) + (1 - y) * np.log(1 - ref))
        for fc in fcs:
            p = wide[tg][fc].values
            b, ll = (p - y) ** 2, -(y * np.log(p) + (1 - y) * np.log(1 - p))
            d, dl = b - ref_b, ll - ref_ll
            r = dict(target=tg, forecaster=fc, brier=b.mean(), logloss=ll.mean(), bss=1 - b.mean() / ref_b.mean(),
                     d_brier=d.mean(), d_ll=dl.mean(),
                     auc=roc_auc_score(y, p) if np.ptp(p) > 0 else np.nan,
                     mean_p=p.mean(), obs=y.mean(), p10=np.quantile(p, 0.1), p90=np.quantile(p, 0.9))
            if fc == REF:
                r.update(lo=np.nan, hi=np.nan, dlo=np.nan, dhi=np.nan, llo=np.nan, lhi=np.nan)
            else:
                bs = d[idx].mean(axis=1)
                r["lo"], r["hi"] = np.quantile(bs, [0.025, 0.975])
                bl = dl[idx].mean(axis=1)
                r["llo"], r["lhi"] = np.quantile(bl, [0.025, 0.975])
                dsum = np.bincount(dcode, weights=d, minlength=len(uday))
                dcnt = np.bincount(dcode, minlength=len(uday)).astype(float)
                bd = dsum[didx].sum(axis=1) / dcnt[didx].sum(axis=1)
                r["dlo"], r["dhi"] = np.quantile(bd, [0.025, 0.975])
            r["slope"], r["slo"], r["shi"] = cal_slope(p, y)
            rows.append(r)
    M = pd.DataFrame(rows).set_index(["target", "forecaster"])
    M.reset_index().to_csv(DATA / "metrics.csv", index=False)

    # ---------- top table (wide: H and NH side by side) ----------
    def cell(tg, fc):
        r = M.loc[(tg, fc)]
        if fc == REF:
            return f"{f5(r.brier)} | ref | ref | - | {r.logloss:.4f} | {'n/a' if np.isnan(r.auc) else f'{r.auc:.3f}'}"
        return (f"{f5(r.brier)} | {100 * r.bss:+.1f}% | {sgn5(r.d_brier)} [{sgn5(r.lo)}, {sgn5(r.hi)}] | {verdict(r.lo, r.hi)} | "
                f"{r.logloss:.4f} | {'n/a' if np.isnan(r.auc) else f'{r.auc:.3f}'}")
    top = ["| forecaster | H Brier | H skill | H Brier diff vs prior_30d [95%] | excl. 0? | H log loss | H AUC | NH Brier | NH skill | NH Brier diff vs prior_30d [95%] | excl. 0? | NH log loss | NH AUC |",
           "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for fc in MAIN:
        top.append(f"| `{fc}` | {cell('H', fc)} | {cell('NH', fc)} |")
    top = "\n".join(top)

    # ---------- body ----------
    out = []
    P = meta["positives"]
    out.append("## Scored set\n")
    out.append(f"- Matured window notes (submitted 2026-08-07 or later and before {meta['maturity_cutoff_utc'][:16]} UTC): {meta['n_matured_window_notes']}.")
    out.append(f"- Scored notes: **{n}**, every matured note submitted from {meta['scored_first_submit'][:16]} to {meta['scored_last_submit'][:16]} UTC. "
               f"The first scored refit day is {meta['scored_first_day']}, the first day with at least {meta['settings']['min_train_scored']} label-available window notes "
               f"(it had {[d for d in meta['days'] if d['scored']][0]['n_train']}; no notes were submitted on Aug 21-22, and Aug 20 had 369).")
    out.append(f"- Positives in the scored set: H {P['H']} ({pc(P['H'] / n)}), NH {P['NH']} ({pc(P['NH'] / n)}), rated at all {P['rated']} ({pc(P['rated'] / n)}).")
    out.append(f"- Unscored: {meta['n_matured_window_notes'] - n - meta['n_burn_in_unscored']} notes before the first burn-in day (no prediction made), and {meta['n_burn_in_unscored']} burn-in notes (Aug 17-20, 100-399 training notes) "
               "that are predicted only so the Platt recalibrator has past predictions to learn from. Neither group enters any metric.")
    out.append(f"- Missing features inside the scored set: evaluation score {meta['feature_missing_in_scored']['eval_score']}, feed_tweets join (tweet age and the canary's feed features) {meta['feature_missing_in_scored']['age_h']}. "
               "These notes are kept and imputed; all forecasters are scored on the identical 977 notes (asserted in code).")
    out.append("")
    out.append("Refit schedule (one row per UTC submit day; `n_train` = window notes with submitted_at < day - 7d; `prior_*` use the full note history):\n")
    out.append("| day | scored | notes that day | n_train | train H | train NH | prior_all H | prior_30d H | n in 30d window | prior_all NH | prior_30d NH |")
    out.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for d in meta["days"]:
        out.append(f"| {d['day']} | {'yes' if d['scored'] else 'burn-in'} | {d['n_test']} | {d['n_train']} | {d['train_pos_H']} | {d['train_pos_NH']} | "
                   f"{pc(d['prior_all_H'])} | {pc(d['prior_30d_H'])} | {d['n_prior_30d']} | {pc(d['prior_all_NH'], 2)} | {pc(d['prior_30d_NH'], 2)} |")

    out.append("\n## Metrics, all forecasters and targets\n")
    out.append(f"Identical {n} notes in every row. Probabilities clipped to [0.001, 0.999] before every metric. Skill = 1 - Brier / Brier(prior_30d). "
               f"Differences are forecaster minus prior_30d, so negative is better. Note bootstrap: {N_BOOT} resamples of notes, percentile interval, same resamples for every row. "
               "Day-block bootstrap: resamples whole submit days (20 days), which allows for notes on the same day sharing a fit and a news cycle; it is the more cautious interval. "
               "`_platt` rows are the optional recalibrated versions.\n")
    for tg in TARGETS:
        y = ys[tg]
        out.append(f"### Target: {tg}  (positives {int(y.sum())} of {n}, {pc(y.mean())})\n")
        out.append("| forecaster | Brier | skill vs prior_30d | Brier diff [note bootstrap 95%] | excludes 0? | Brier diff [day-block 95%] | excludes 0? | log loss | log loss diff [95%] | AUC |")
        out.append("|---|---|---|---|---|---|---|---|---|---|")
        for fc in fcs:
            r = M.loc[(tg, fc)]
            auc = "n/a" if np.isnan(r.auc) else f"{r.auc:.3f}"
            if fc == REF:
                out.append(f"| `{fc}` | {f5(r.brier)} | ref | ref | - | ref | - | {r.logloss:.4f} | ref | {auc} |")
            else:
                out.append(f"| `{fc}` | {f5(r.brier)} | {100 * r.bss:+.1f}% | {sgn5(r.d_brier)} [{sgn5(r.lo)}, {sgn5(r.hi)}] | {verdict(r.lo, r.hi)} | "
                           f"[{sgn5(r.dlo)}, {sgn5(r.dhi)}] | {verdict(r.dlo, r.dhi)} | {r.logloss:.4f} | {r.d_ll:+.4f} [{r.llo:+.4f}, {r.lhi:+.4f}] | {auc} |")
        out.append("")

    out.append("## Hindsight ceilings (NOT forecasts)\n")
    out.append("These rows use the scored outcomes themselves, so none of them is a legal forecast. They size what was on the table. "
               "`constant at observed rate` is the best any single number could do. `level fixed` adds one constant to a model's logits, fitted on the scored set, "
               "so the ranking and spread are the model's own and only the base-rate error is removed. `level and slope fixed` also rescales the logits (in-sample Platt, 2 parameters, slightly optimistic).\n")
    out.append("| target | row | Brier | vs prior_30d | vs constant at observed rate | log loss |")
    out.append("|---|---|---|---|---|---|")
    for tg in TARGETS:
        y = ys[tg]
        refb = M.loc[(tg, REF), "brier"]
        c = np.full(n, y.mean())
        cb = ((c - y) ** 2).mean()
        ll = lambda q: -(y * np.log(q) + (1 - y) * np.log(1 - q)).mean()
        out.append(f"| {tg} | `prior_30d` as forecast (legal) | {f5(refb)} | ref | {sgn5(refb - cb)} | {M.loc[(tg, REF), 'logloss']:.4f} |")
        out.append(f"| {tg} | constant at observed rate | {f5(cb)} | {sgn5(cb - refb)} | ref | {ll(c):.4f} |")
        for fc in ["eval_only", "stable4", "stable4_no_earlier", "gbm_canary"]:
            x = np.log(wide[tg][fc].values / (1 - wide[tg][fc].values))
            q1 = irls(np.ones((n, 1)), y, offset=x)
            q2 = irls(np.column_stack([np.ones(n), x]), y)
            for lab, q in [("level fixed", q1), ("level and slope fixed", q2)]:
                b = ((q - y) ** 2).mean()
                out.append(f"| {tg} | `{fc}`, {lab} | {f5(b)} | {sgn5(b - refb)} | {sgn5(b - cb)} | {ll(q):.4f} |")
    out.append("")

    out.append("## Calibration summary and sharpness\n")
    out.append("Calibration-in-the-large = mean predicted minus observed rate. Slope = unpenalised logistic regression of the outcome on logit(prediction), Wald 95% interval; "
               "1.0 is ideal, below 1 means the predictions are too spread out. For the two priors the predictions barely vary, so their slope is not informative. "
               "Sharpness = 10th to 90th percentile of the predictions.\n")
    out.append("| target | forecaster | mean predicted | observed | predicted minus observed | calibration slope [95%] | sharpness p10 to p90 |")
    out.append("|---|---|---|---|---|---|---|")
    for tg in TARGETS:
        for fc in fcs:
            r = M.loc[(tg, fc)]
            sl = "n/a" if np.isnan(r.slope) else f"{r.slope:.2f} [{r.slo:.2f}, {r.shi:.2f}]"
            out.append(f"| {tg} | `{fc}` | {pc(r.mean_p, 2)} | {pc(r.obs, 2)} | {100 * (r.mean_p - r.obs):+.2f}pp | {sl} | {pc(r.p10)} to {pc(r.p90)} |")

    out.append("\n## Drift inside the scored set (target H)\n")
    out.append("Observed H rate against each forecaster's mean prediction, by submit week. Shows how far the lagged base rate trails the outcome.\n")
    wk = pd.Series(when.dt.tz_convert(None).dt.to_period("W-SAT").dt.start_time.dt.date.values, index=wide["H"].index)
    out.append("| week starting | n | H | observed | " + " | ".join(f"`{f}`" for f in MAIN) + " |")
    out.append("|---|---|---|---|" + "---|" * len(MAIN))
    for w_, ix in wk.groupby(wk).groups.items():
        m = wide["H"].index.isin(ix)
        lo, hi = wilson(ys["H"][m].sum(), m.sum())
        out.append(f"| {w_} | {m.sum()} | {int(ys['H'][m].sum())} | {pc(ys['H'][m].mean())} [{pc(lo)}, {pc(hi)}] | " +
                   " | ".join(pc(wide["H"].loc[m, f].mean()) for f in MAIN) + " |")

    act = sc[sc["forecaster"].isin(PLATT)].groupby(["target", "forecaster"])["recal_active"].agg(["sum", "size"])
    out.append("\n## Platt recalibration coverage\n")
    out.append(f"On refit day D the recalibrator is fitted on earlier walk-forward predictions for notes submitted before D - 7d, and only once it has at least "
               f"{meta['settings']['platt']['min_n']} of them with at least {meta['settings']['platt']['min_pos']} positives; before that the `_platt` row equals the raw model.\n")
    out.append("| target | forecaster | scored notes with recalibration active |")
    out.append("|---|---|---|")
    for (tg, fc), r in act.iterrows():
        out.append(f"| {tg} | `{fc}` | {int(r['sum'])} of {int(r['size'])} |")

    out.append("\n## Calibration tables\n")
    out.append("Observed-rate intervals are Wilson 95%. Quantile bins are 5 equal-count bins of that forecaster's own predictions (fewer when ties collapse bin edges, as for the priors). † marks n < 30.\n")
    for tg in TARGETS:
        y = ys[tg]
        for fc in fcs:
            p = wide[tg][fc].values
            out.append(f"### {tg} / `{fc}`\n")
            for kind in ["quantile", "fixed"]:
                if kind == "quantile":
                    b = pd.qcut(p, 5, duplicates="drop")
                else:
                    b = pd.cut(p, FIXED, labels=FIXED_LAB, right=False)
                out.append(f"| {kind} bin | n | mean predicted | observed | positives | Wilson 95% |")
                out.append("|---|---|---|---|---|---|")
                t = pd.DataFrame({"b": b, "p": p, "y": y}).groupby("b", observed=True).agg(n=("y", "size"), mp=("p", "mean"), k=("y", "sum"))
                for lab, r in t.iterrows():
                    lo, hi = wilson(r.k, r.n)
                    lab_s = lab if kind == "fixed" else f"{100 * lab.left:.1f}-{100 * lab.right:.1f}%"
                    out.append(f"| {lab_s}{' †' if r.n < 30 else ''} | {int(r.n)} | {pc(r.mp)} | {pc(r.k / r.n)} | {int(r.k)} | [{pc(lo)}, {pc(hi)}] |")
                out.append("")

    out.append(METHOD)
    body = "\n".join(out)

    path = HERE / "RESULTS.md"
    head = path.read_text().split(AUTO)[0] if path.exists() else DEFAULT_HEAD
    if TT0 in head and TT1 in head:
        head = head.split(TT0)[0] + TT0 + "\n" + top + "\n" + TT1 + head.split(TT1)[1]
    path.write_text(head.rstrip("\n") + "\n\n" + AUTO + "\n\n" + body + "\n")
    print(top)
    print(M.reset_index()[["target", "forecaster", "brier", "bss", "d_brier", "lo", "hi", "dlo", "dhi", "logloss", "auc", "mean_p", "obs", "slope", "p10", "p90"]].round(5).to_string())


DEFAULT_HEAD = f"""# Forecast baselines: walk-forward P(H) and P(NH) at submit time (2026-09-18)

(top section not written yet)

{TT0}
{TT1}
"""

METHOD = """## Method, settings, leakage notes

The numbered lines at the top of this file are hand-written from the tables below; the top table and everything under the AUTO marker are regenerated by `uv run forecast.py` then `uv run metrics.py`. All settings were fixed before any result was computed, and only one setting per model was run: `forecast.py` completed once (an earlier attempt crashed on a timezone bug before writing anything). The Platt rows were part of that single run. The hindsight table was added after the results were seen; it is a diagnostic, not a forecaster, and changes no forecast.

- **Walk-forward.** One refit per UTC calendar day D of submit time. Models train on window notes (2026-08-07 onward) with submitted_at < D - 7d, labels as they stand at pull time. Every note submitted during day D is predicted by that fit, so a note late in the day gives up to 24 h of labels it could legally have used. Imputation medians and scaling statistics come from the training rows only.
- **`prior_all`.** H (or NH, or rated) rate over every note in the `notes` table (back to 2025, 8,808 rows) with submitted_at < D - 7d. **`prior_30d`.** Same, over notes with D - 37d <= submitted_at < D - 7d (the latest 30 days whose labels are available), shrunk as (k + 50 * prior_all) / (n + 50). n was 1,573 to 1,949, so the shrinkage moves it by under 0.1pp. The priors use the full note history because a live forecaster would have it; models cannot, because features were pulled only for the window.
- **`eval_only`.** Logistic, C=1.0: evaluation score (standardised) + missing flag. **`stable4`.** Logistic, C=1.0: any earlier note on the tweet (0/1), tweet age in hours at first sight (clipped 0-48, standardised) + feed-missing flag, author history as two dummies (history with no H; history with an H; baseline no history), evaluation score + missing flag. **`stable4_no_earlier`.** Same without the earlier-note flag.
- **`gbm_canary`.** sklearn GradientBoostingClassifier, 100 trees, depth 2, learning rate 0.05, subsample 0.8, min leaf 20, seed 0. stable4 features plus earlier-note count (capped at 5), feed tier (small/large/xl as 0/1/2), log10 velocity at first sight, log10 author followers, has_video, has_photo, media_count, is_quote. Expected to overfit; it is a canary, not a candidate.
- **`_platt` rows.** Logistic regression (C=1e4) of the outcome on logit(raw walk-forward prediction), refit each day on predictions for notes submitted before D - 7d. Needs 300 past predictions and 15 positives, else falls back to the raw model. A model with fewer than 5 training positives outputs prior_30d (this only happened in burn-in days).
- **Missing data.** Evaluation score missing: median-imputed + flag. The flag has 1 training example before Sep 16, so its coefficient is about zero and outage notes (Sep 9-11) are effectively forecast at the median score. feed_tweets join missing: median-imputed + flag. No note is dropped.

Leakage checks and residual risks:

1. **Labels are today's status, not status at day 7.** Training labels, prior counts and the author-history feature all use cn_status at pull time. The screen measured 99.5% of statuses as final by day 7, so this is small, but a note that flipped after day 7 is seen with its later status. Cannot be fixed without status history.
2. **Earlier-note flag.** Built from competing_notes.created_at_millis < our submitted_at, so it is knowable in principle, but it comes from X's public dump, which lags about 48 h. `stable4_no_earlier` is the version that does not depend on it. The competitor's *status* is never used (that was the leaky cut in the screen).
3. **Evaluation score.** pipeline_scores.created_at is before submitted_at for all 1,937 runs that have a score (checked: minimum gap 1.1 s).
4. **Author history.** Counts only our notes on the same author_id submitted more than 7 days before this note. Evaluated per note, not per refit day.
5. **Feed features.** first_seen_* columns and raw_tweet are written once at first sight. `author_followers` can be refreshed by later capture runs; it only enters the canary.
6. **Calibration bins** are cut on the scored predictions themselves; they describe, they are not used for fitting.
7. **Leak test (run once, not part of the scripts).** Every label for notes submitted on or after 2026-08-30 00:00 UTC was replaced with a random H/NH and the walk-forward was rerun: all 33,180 predictions for refit days up to 2026-09-05 were identical to the last digit, and predictions for later days moved. `prior_all` and `prior_30d` for that day were also recomputed independently from notes.parquet and matched.
8. **Intervals.** 27 forecaster-target rows times 3 intervals each = 81 intervals; a few will exclude zero by chance.
9. **Bootstrap intervals** treat notes as independent. Notes share a daily fit, a news cycle and sometimes an author, so the note-level interval is somewhat too narrow; the day-block interval is shown alongside.
"""

if __name__ == "__main__":
    main()
