# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""Score data/predictions.parquet and write RESULTS.md.

The top section of RESULTS.md is hand-written and preserved; the top tables (between
the markers) and everything below the AUTO marker are regenerated.
Run:  uv run pretrain.py && uv run run.py && uv run report.py
"""
import json

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

import common as C

AUTO = "<!-- AUTO-GENERATED BELOW THIS LINE BY report.py; edits below are overwritten -->"
T0, T1 = "<!-- LEVEL-TABLE-START -->", "<!-- LEVEL-TABLE-END -->"
D0, D1 = "<!-- DECOMP-TABLE-START -->", "<!-- DECOMP-TABLE-END -->"
REF = "prior_30d"
N_BOOT, SEED = 2000, 0

LEVEL_ROWS = ["prior_all", "prior_30d", "ewma_hl7", "ewma_hl14", "ewma_hl30", "ewma_hl60",
              "ewma_sel", "ewma_auto", "local_linear_trend", "smooth_trend",
              "stable4", "stable4_lvl_ewma_sel", "stable4_lvl_local_linear_trend",
              "stable4_lvl_smooth_trend"]
DECOMP_ROWS = ["prior_30d", "stable4", "ewma_sel", "two_prior", "two_prior_m50", "two_prior_m200",
               "two_ewma", "two_stable4", "two_stable4_lvl"]
ALL_ROWS = LEVEL_ROWS + [r for r in DECOMP_ROWS if r not in LEVEL_ROWS]


def f5(x):
    return f"{x:.5f}"


def s5(x):
    return f"{x:+.5f}"


def pc(x, d=2):
    return "n/a" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{100 * x:.{d}f}%"


def verdict(lo, hi):
    return "yes, better" if hi < 0 else ("yes, worse" if lo > 0 else "no")


def irls(X, y, ridge=1e-4):
    """Unpenalised-ish logistic fit by Newton steps (tiny ridge for numerical stability).
    Returns (coefficients, Wald standard errors)."""
    b = np.zeros(X.shape[1])
    R = ridge * np.eye(X.shape[1])
    Hm = None
    for _ in range(200):
        mu = 1 / (1 + np.exp(-np.clip(X @ b, -30, 30)))
        W = mu * (1 - mu)
        Hm = X.T @ (X * W[:, None]) + R
        step = np.linalg.solve(Hm, X.T @ (y - mu) - ridge * b)
        b = b + np.clip(step, -4, 4)
        if np.abs(step).max() < 1e-9:
            break
    return b, np.sqrt(np.diag(np.linalg.inv(Hm)))


def descriptive_fits(df):
    """In-sample, descriptive only (NOT a forecast): which features load on which factor.
    Continuous features standardised over the fitting sample so coefficients compare."""
    X = C.features(df)[C.STABLE4].copy()
    X = X.fillna(X.median().fillna(0.0))
    for c in C.CONT:
        X[c] = (X[c] - X[c].mean()) / (X[c].std() or 1.0)
    M = np.column_stack([np.ones(len(X)), X.values])
    rated = df["rated"].values == 1
    out = []
    jobs = [("P(rated), all notes", M, df["rated"].values.astype(float), None),
            ("P(H | rated), rated notes only", M[rated], df["H"].values[rated].astype(float), None),
            ("P(H), all notes (one stage)", M, df["H"].values.astype(float), None),
            ("P(NH), all notes (one stage)", M, df["NH"].values.astype(float), None)]
    for name, Xm, y, _ in jobs:
        # re-standardise inside the sub-sample so the two factors are on their own scales
        Xs = Xm.copy()
        for j, c in enumerate(C.STABLE4, start=1):
            if c in C.CONT:
                col = Xs[:, j]
                Xs[:, j] = (col - col.mean()) / (col.std() or 1.0)
        b, se = irls(Xs, y)
        for j, c in enumerate(["(intercept)"] + C.STABLE4):
            out.append(dict(factor=name, n=len(y), pos=int(y.sum()), feature=c,
                            coef=b[j], se=se[j], z=b[j] / se[j] if se[j] > 0 else np.nan,
                            share=float(Xs[:, j].mean()) if c != "(intercept)" and c not in C.CONT else np.nan))
    return pd.DataFrame(out)


def main():
    meta = json.loads((C.OUT / "run_meta.json").read_text())
    pre = json.loads((C.OUT / "pretrain.json").read_text())
    pred = pd.read_parquet(C.OUT / "predictions.parquet")
    sc = pred[pred["scored"]].copy()
    sc["p"] = sc["p"].clip(*C.CLIP)

    wide, ys = {}, {}
    for tg in C.TARGETS:
        g = sc[sc["target"] == tg]
        w = g.pivot(index="note_id", columns="forecaster", values="p")[ALL_ROWS]
        assert not w.isna().any().any(), "every forecaster must cover the identical scored set"
        mg = g[g["forecaster"] == REF].set_index("note_id").loc[w.index]
        wide[tg], ys[tg] = w, mg["y"].values.astype(float)
        days, when = mg["refit_day"].values, mg["submitted_at"]
    n = len(wide["H"])
    assert all(len(wide[t]) == n and (wide[t].index == wide["H"].index).all() for t in C.TARGETS)

    rng = np.random.default_rng(SEED)
    idx = rng.integers(0, n, size=(N_BOOT, n))
    uday, dcode = np.unique(days, return_inverse=True)
    didx = rng.integers(0, len(uday), size=(N_BOOT, len(uday)))

    rows = []
    for tg in C.TARGETS:
        y = ys[tg]
        ref = wide[tg][REF].values
        rb = (ref - y) ** 2
        rl = -(y * np.log(ref) + (1 - y) * np.log(1 - ref))
        for fc in ALL_ROWS:
            p = wide[tg][fc].values
            b = (p - y) ** 2
            ll = -(y * np.log(p) + (1 - y) * np.log(1 - p))
            d, dl = b - rb, ll - rl
            r = dict(target=tg, forecaster=fc, brier=b.mean(), logloss=ll.mean(),
                     bss=1 - b.mean() / rb.mean(), d_brier=d.mean(), d_ll=dl.mean(),
                     mean_p=p.mean(), obs=y.mean(), cil=p.mean() - y.mean(),
                     auc=roc_auc_score(y, p) if np.ptp(p) > 0 else np.nan,
                     p10=np.quantile(p, 0.1), p90=np.quantile(p, 0.9))
            if fc == REF:
                r.update(lo=np.nan, hi=np.nan, dlo=np.nan, dhi=np.nan, llo=np.nan, lhi=np.nan)
            else:
                r["lo"], r["hi"] = np.quantile(d[idx].mean(axis=1), [0.025, 0.975])
                r["llo"], r["lhi"] = np.quantile(dl[idx].mean(axis=1), [0.025, 0.975])
                ds = np.bincount(dcode, weights=d, minlength=len(uday))
                dc = np.bincount(dcode, minlength=len(uday)).astype(float)
                r["dlo"], r["dhi"] = np.quantile(ds[didx].sum(axis=1) / dc[didx].sum(axis=1), [0.025, 0.975])
            rows.append(r)
    M = pd.DataFrame(rows).set_index(["target", "forecaster"])
    M.reset_index().to_csv(C.OUT / "metrics.csv", index=False)

    # hindsight constant
    hind = {}
    for tg in C.TARGETS:
        y = ys[tg]
        c = np.full(n, y.mean())
        hind[tg] = dict(brier=((c - y) ** 2).mean(),
                        logloss=float(-(y * np.log(np.clip(c, *C.CLIP)) + (1 - y) * np.log(1 - np.clip(c, *C.CLIP))).mean()))

    def row(tg, fc, extra=""):
        r = M.loc[(tg, fc)]
        if fc == REF:
            return (f"| `{fc}`{extra} | {f5(r.brier)} | ref | - | {pc(r.mean_p)} / {pc(r.obs)} "
                    f"| {100 * r.cil:+.2f}pp | {r.logloss:.4f} |")
        return (f"| `{fc}`{extra} | {f5(r.brier)} | {s5(r.d_brier)} [{s5(r.lo)}, {s5(r.hi)}] | {verdict(r.lo, r.hi)} "
                f"| {pc(r.mean_p)} / {pc(r.obs)} | {100 * r.cil:+.2f}pp | {r.logloss:.4f} |")

    HEAD = ("| forecaster | Brier | Brier diff vs `prior_30d` [note boot 95%] | excl. 0? "
            "| mean pred / observed | cal-in-large | log loss |")
    SEP = "|---|---|---|---|---|---|---|"

    lvl_tbl = [HEAD, SEP]
    for fc in LEVEL_ROWS:
        mark = "  **(headline)**" if fc == "ewma_sel" else ""
        lvl_tbl.append(row("H", fc, mark))
    r = hind["H"]
    lvl_tbl.append(f"| *constant at observed rate (HINDSIGHT, not a forecast)* | {f5(r['brier'])} | "
                   f"{s5(r['brier'] - M.loc[('H', REF), 'brier'])} | - | 9.21% / 9.21% | +0.00pp | {r['logloss']:.4f} |")
    lvl_tbl = "\n".join(lvl_tbl)

    dec_tbl = []
    for tg in ["H", "NH"]:
        dec_tbl += [f"**Target {tg}** (positives {int(ys[tg].sum())} of {n})", "", HEAD, SEP]
        for fc in DECOMP_ROWS:
            dec_tbl.append(row(tg, fc))
        dec_tbl.append("")
    dec_tbl = "\n".join(dec_tbl).rstrip()

    # ---------------- body ----------------
    o = []
    P = meta["positives"]
    o.append("## Scored set and reproduction check\n")
    o.append(f"- Identical to the prior backtest: **{n}** matured notes submitted "
             f"{meta['scored_first_submit'][:16]} to {meta['scored_last_submit'][:16]} UTC. "
             f"H {P['H']} ({pc(P['H'] / n, 1)}), NH {P['NH']} ({pc(P['NH'] / n, 1)}), rated at all {P['rated']} ({pc(P['rated'] / n, 1)}).")
    o.append(f"- `prior_30d`, `prior_all` and `stable4` were recomputed here from scratch and reproduce the prior run's "
             f"predictions to the last digit (max absolute difference 0.0 over all three targets); "
             f"`prior_30d` H Brier = {f5(M.loc[('H', REF), 'brier'])}, the number to beat.")
    o.append(f"- All {len(ALL_ROWS)} forecasters cover the identical {n} notes for all three targets (asserted in code).")
    o.append("")

    o.append("## Pre-registration and what the selection rule chose\n")
    ss, ns = pre["selection_set"], pre["narrow_set"]
    o.append(f"- Half-life grid, fixed before running: **{pre['half_lives']}** days. Every one is reported below.")
    o.append(f"- Rule: lowest Brier for H on the selection set = every note submitted {ss['start'][:10]} to "
             f"{C.SELECT_END - pd.Timedelta(days=1):%Y-%m-%d} UTC ({ss['n']} notes, {ss['H']} H, {pc(ss['rate'], 1)}), "
             "whose labels had all resolved by the first scored refit day. Ties -> longer half-life.")
    o.append(f"- **It chose `{pre['chosen']}`** (half-life {pre['chosen_half_life']} days) - the longest, i.e. the "
             "training period asked for a *slower* forecaster, not a faster one.")
    o.append(f"- The narrower robustness set ({ns['n']} window notes submitted {ns['start'][:10]} to "
             f"{C.SELECT_END - pd.Timedelta(days=1):%Y-%m-%d}) would have chosen `{pre['chosen_narrow']}`. "
             "Reported for honesty; it is not the headline.")
    o.append("")
    o.append("Selection-set Brier (training period, H). The spread across the grid is 0.00009, i.e. the "
             "training period contains essentially no information about the right half-life:\n")
    o.append("| forecaster | n | Brier | mean predicted | observed |")
    o.append("|---|---|---|---|---|")
    for r_ in sorted(pre["selection_table"], key=lambda z: z["brier"]):
        o.append(f"| `{r_['forecaster']}` | {int(r_['n'])} | {r_['brier']:.5f} | {pc(r_['mean_p'])} | {pc(r_['obs'])} |")
    o.append("")
    o.append("Same on the narrow robustness set:\n")
    o.append("| forecaster | n | Brier | mean predicted | observed |")
    o.append("|---|---|---|---|---|")
    for r_ in sorted(pre["narrow_table"], key=lambda z: z["brier"]):
        o.append(f"| `{r_['forecaster']}` | {int(r_['n'])} | {r_['brier']:.5f} | {pc(r_['mean_p'])} | {pc(r_['obs'])} |")

    o.append("\n## State-space fits (training period only)\n")
    o.append("Both filters run on the daily logit of the outcome rate over the whole note history "
             f"({pre['llt']['H']['first_day']} to {pre['llt']['H']['last_day']}, "
             f"{pre['llt']['H']['n_days']} days with notes), diffuse prior (P0 = 1e6 I, first two observations "
             "left out of the likelihood), Haldane-corrected daily logits with binomial observation variances. "
             "Variances estimated by maximum likelihood on days strictly before 2026-08-16 and then held fixed.\n")
    o.append("| target | model | q_level | q_slope | training log-likelihood |")
    o.append("|---|---|---|---|---|")
    for tg in C.TARGETS:
        for nm, key in [("local_linear_trend", "llt"), ("smooth_trend", "smooth_trend")]:
            p_ = pre[key][tg]
            o.append(f"| {tg} | `{nm}` | {p_['q_level']:.3e} | {p_['q_slope']:.3e} | {p_['loglik']:.2f} |")
    o.append("")
    o.append("**The unrestricted local-linear-trend MLE puts the slope variance on the zero boundary for all three "
             "targets.** The training data prefer a local *level* (random walk) with one constant global drift; "
             "there is no time-varying trend to extrapolate. `smooth_trend` (level noise switched off, only the slope "
             "innovates) was added *after seeing that training-period diagnostic and before any test metric was "
             "computed*, to give a genuinely extrapolating model a fair run. Its training log-likelihood is worse "
             "than the local level's for every target, so the data did not want it either.")

    o.append("\n## Job 1: level forecasters, all three targets\n")
    o.append(f"Identical {n} notes in every row, probabilities clipped to {list(C.CLIP)} before every metric. "
             f"Differences are forecaster minus `prior_30d`, negative is better. Note bootstrap: {N_BOOT} resamples of "
             "notes, percentile interval, the same resamples in every row. The day-block bootstrap resamples whole "
             "submit days (20 of them) and is the more cautious interval.\n")
    for tg in C.TARGETS:
        y = ys[tg]
        o.append(f"### Target {tg} (positives {int(y.sum())} of {n}, {pc(y.mean(), 1)})\n")
        o.append("| forecaster | Brier | skill | Brier diff [note boot 95%] | excl. 0? | Brier diff [day block 95%] "
                 "| excl. 0? | mean pred | observed | cal-in-large | log loss | AUC | p10-p90 |")
        o.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for fc in ALL_ROWS:
            r_ = M.loc[(tg, fc)]
            auc = "n/a" if np.isnan(r_.auc) else f"{r_.auc:.3f}"
            if fc == REF:
                o.append(f"| `{fc}` | {f5(r_.brier)} | ref | ref | - | ref | - | {pc(r_.mean_p)} | {pc(r_.obs)} | "
                         f"{100 * r_.cil:+.2f}pp | {r_.logloss:.4f} | {auc} | {pc(r_.p10, 1)}-{pc(r_.p90, 1)} |")
            else:
                o.append(f"| `{fc}` | {f5(r_.brier)} | {100 * r_.bss:+.1f}% | {s5(r_.d_brier)} [{s5(r_.lo)}, {s5(r_.hi)}] | "
                         f"{verdict(r_.lo, r_.hi)} | [{s5(r_.dlo)}, {s5(r_.dhi)}] | {verdict(r_.dlo, r_.dhi)} | "
                         f"{pc(r_.mean_p)} | {pc(r_.obs)} | {100 * r_.cil:+.2f}pp | {r_.logloss:.4f} | {auc} | "
                         f"{pc(r_.p10, 1)}-{pc(r_.p90, 1)} |")
        h = hind[tg]
        o.append(f"| *constant at observed rate (HINDSIGHT)* | {f5(h['brier'])} | "
                 f"{100 * (1 - h['brier'] / M.loc[(tg, REF), 'brier']):+.1f}% | {s5(h['brier'] - M.loc[(tg, REF), 'brier'])} | - "
                 f"| - | - | {pc(y.mean())} | {pc(y.mean())} | +0.00pp | {h['logloss']:.4f} | n/a | - |")
        o.append("")

    o.append("## Daily level forecasts inside the scored period (target H)\n")
    d = pd.read_csv(C.OUT / "level_by_day.csv")
    d = d[d["scored"]]
    o.append("`steps` is how many days the state-space forecast is projected past its last observed day. "
             "`slope` is the filtered slope in logits per day.\n")
    o.append("| day | notes | `prior_30d` | `ewma_hl7` | `ewma_hl14` | `ewma_hl30` | `ewma_hl60` = `ewma_sel` | "
             "`ewma_auto` pick | `local_linear_trend` | slope | `smooth_trend` | slope | steps |")
    o.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for _, rr in d.iterrows():
        o.append(f"| {rr['day']} | {int(rr['n_test'])} | {pc(rr['prior_30d_H'], 1)} | {pc(rr['ewma_hl7_H'], 1)} | "
                 f"{pc(rr['ewma_hl14_H'], 1)} | {pc(rr['ewma_hl30_H'], 1)} | {pc(rr['ewma_hl60_H'], 1)} | "
                 f"{rr['auto_pick_H']} | {pc(rr['local_linear_trend_H'], 1)} | {rr['local_linear_trend_slope_H']:+.4f} | "
                 f"{pc(rr['smooth_trend_H'], 1)} | {rr['smooth_trend_slope_H']:+.4f} | {int(rr['local_linear_trend_steps_H'])} |")

    o.append("\n## Why the winning half-life wins: it looks back further, it is not more responsive\n")
    hist_ = C.get_data()[5]
    last_h = pd.Timestamp(d["day"].iloc[-1], tz="UTC") - C.LAG
    hh = hist_[hist_["when"] < last_h]
    age = (last_h - hh["when"]).dt.total_seconds().values / 86400.0
    look = []
    for hl in C.HALF_LIVES:
        w = np.power(2.0, -age / hl)
        look.append((f"ewma_hl{hl}", (w * age).sum() / w.sum(), w.sum()))
    m30 = age < 30
    look.append(("prior_30d", age[m30].mean(), float(m30.sum())))
    look.append(("prior_all", age.mean(), float(len(age))))
    o.append("Weighted mean age of the labels each level forecaster actually uses, measured at the last refit day "
             f"({d['day'].iloc[-1]}, label horizon {last_h:%Y-%m-%d}), plus the effective sample size:\n")
    o.append("| forecaster | weighted mean label age (days before the horizon) | effective n |")
    o.append("|---|---|---|")
    for nm, a_, w_ in look:
        o.append(f"| `{nm}` | {a_:.1f} | {w_:.0f} |")
    o.append("")
    o.append("Observed H rate by submit week inside the scored period against each level forecaster's mean "
             "prediction. Read the columns for responsiveness (how much a forecaster moves) and the rows for level:\n")
    wk = pd.Series(when.dt.tz_convert(None).dt.to_period("W-SAT").dt.start_time.dt.date.values, index=wide["H"].index)
    lv = ["prior_30d", "ewma_hl7", "ewma_hl14", "ewma_hl30", "ewma_hl60", "local_linear_trend", "smooth_trend"]
    o.append("| week starting | n | H | observed | " + " | ".join(f"`{f}`" for f in lv) + " |")
    o.append("|---|---|---|---|" + "---|" * len(lv))
    for w_, ix in wk.groupby(wk).groups.items():
        mm = wide["H"].index.isin(ix)
        o.append(f"| {w_} | {mm.sum()} | {int(ys['H'][mm].sum())} | {pc(ys['H'][mm].mean(), 1)} | " +
                 " | ".join(pc(wide["H"].loc[mm, f].mean(), 1) for f in lv) + " |")
    o.append("")
    o.append("The winner moves *less* than `prior_30d` over the period, it simply sits lower. Its 30-day rivals "
             "average the last month, which was August at 12 to 13%; a 60-day half-life still carries July "
             "(9.1% H) and, further back, April (8.1%) and March (4.6%). The gain is a longer, lower memory, "
             "not extrapolation - the opposite of the fix this job set out to test.")

    o.append("\n## Pairwise contrasts (does the ranking add anything on top of a better level?)\n")
    o.append("Same note-level and day-block bootstrap, but against a reference other than `prior_30d`. "
             "Negative favours the first-named forecaster.\n")
    o.append("| target | contrast | Brier diff [note boot 95%] | excl. 0? | Brier diff [day block 95%] | excl. 0? | log loss diff |")
    o.append("|---|---|---|---|---|---|---|")
    pairs = [("H", "stable4_lvl_ewma_sel", "ewma_sel"), ("H", "stable4_lvl_ewma_sel", "stable4"),
             ("H", "two_stable4_lvl", "stable4_lvl_ewma_sel"), ("H", "two_stable4", "stable4"),
             ("H", "two_ewma", "ewma_sel"), ("NH", "two_stable4", "stable4"),
             ("NH", "two_stable4_lvl", "stable4"), ("rated", "ewma_sel", "prior_30d")]
    for tg, a_, b_ in pairs:
        y = ys[tg]
        pa, pb = wide[tg][a_].values, wide[tg][b_].values
        dd = (pa - y) ** 2 - (pb - y) ** 2
        dll = (-(y * np.log(pa) + (1 - y) * np.log(1 - pa))) - (-(y * np.log(pb) + (1 - y) * np.log(1 - pb)))
        lo_, hi_ = np.quantile(dd[idx].mean(axis=1), [0.025, 0.975])
        ds = np.bincount(dcode, weights=dd, minlength=len(uday))
        dc = np.bincount(dcode, minlength=len(uday)).astype(float)
        dlo_, dhi_ = np.quantile(ds[didx].sum(axis=1) / dc[didx].sum(axis=1), [0.025, 0.975])
        o.append(f"| {tg} | `{a_}` vs `{b_}` | {s5(dd.mean())} [{s5(lo_)}, {s5(hi_)}] | {verdict(lo_, hi_)} | "
                 f"[{s5(dlo_)}, {s5(dhi_)}] | {verdict(dlo_, dhi_)} | {dll.mean():+.4f} |")

    o.append("\n## Job 2: one stage versus two stage\n")
    o.append("`two_prior` = `prior_30d`(rated) x P(H | rated) from the latest 30 available days of rated notes, shrunk "
             f"to the all-history conditional rate by {C.COND_SHRINK_M} pseudo-notes (`_m50` / `_m200` are the "
             "sensitivities). `two_ewma` uses the selected EWMA level for both factors. `two_stable4` puts the stable4 "
             "features on both factors: the rated factor is the plain logistic, the conditional factor is a heavier-L2 "
             f"logistic (C={C.COND_C}) whose intercept is replaced by the shrunk conditional level and whose centred "
             f"linear predictor is multiplied by lambda = n_rated / (n_rated + {C.COND_LAMBDA_K}) "
             f"(lambda ran {d['cond_lambda'].min():.2f} to {d['cond_lambda'].max():.2f} over the scored days). "
             "`two_stable4_lvl` additionally swaps the rated factor's intercept for the selected EWMA level. "
             "P(NH) = P(rated) x (1 - P(H | rated)).\n")
    o.append(dec_tbl)

    o.append("\n### Conditional factor by day\n")
    o.append("| day | rated notes in training | P(rated) `prior_30d` | P(H\\|rated) shrunk | all-history P(H\\|rated) | lambda |")
    o.append("|---|---|---|---|---|---|")
    for _, rr in d.iterrows():
        o.append(f"| {rr['day']} | {int(rr['n_train_rated'])} | {pc(rr['two_prior_rated'], 1)} | "
                 f"{pc(rr['cond_30d_H'], 1)} | {pc(rr['cond_all_H'], 1)} | {rr['cond_lambda']:.2f} |")

    # ---------------- feature split ----------------
    _, _, _, _, dfw, _ = C.get_data()
    fits = descriptive_fits(dfw)
    fits.to_csv(C.OUT / "descriptive_coefficients.csv", index=False)
    o.append("\n## Which features load on which factor\n")
    o.append(f"Descriptive, **in-sample, not a forecast**: one unpenalised logistic fit per factor over all "
             f"{len(dfw)} matured window notes (2026-08-07 to 2026-09-11), continuous features standardised within "
             "each fitting sample so the coefficients are comparable. `|z| > 2` is the rough flag. The conditional "
             "factor has only 288 rows, so its coefficients are noisy; that is exactly why the forecaster shrinks them.\n")
    o.append("| feature | P(rated), n=2026 | P(H \\| rated), n=288 | P(H), n=2026 | P(NH), n=2026 |")
    o.append("|---|---|---|---|---|")
    piv = fits.pivot(index="feature", columns="factor", values=["coef", "z"])
    order = ["(intercept)"] + C.STABLE4
    cols = ["P(rated), all notes", "P(H | rated), rated notes only", "P(H), all notes (one stage)",
            "P(NH), all notes (one stage)"]
    for f_ in order:
        cells = []
        for c_ in cols:
            cells.append(f"{piv.loc[f_, ('coef', c_)]:+.3f} (z {piv.loc[f_, ('z', c_)]:+.1f})")
        o.append(f"| `{f_}` | " + " | ".join(cells) + " |")

    o.append("\n### Walk-forward coefficients (mean over the 20 scored refit days)\n")
    wf = pd.read_csv(C.OUT / "walk_forward_coefficients.csv")
    g = wf.groupby("factor")[["intercept"] + C.STABLE4].mean()
    o.append("| factor | " + " | ".join(f"`{c}`" for c in ["intercept"] + C.STABLE4) + " |")
    o.append("|---|" + "---|" * (len(C.STABLE4) + 1))
    for f_, rr in g.iterrows():
        o.append(f"| `{f_}` | " + " | ".join(f"{rr[c]:+.3f}" for c in ["intercept"] + C.STABLE4) + " |")
    o.append("\n(L2-penalised, so these are shrunk; `H_given_rated` uses C=0.1 and its slopes are then further "
             "multiplied by lambda before use.)")

    o.append(METHOD)
    body = "\n".join(o)

    path = C.HERE / "RESULTS.md"
    head = path.read_text().split(AUTO)[0] if path.exists() else DEFAULT_HEAD
    for a, b_, t in [(T0, T1, lvl_tbl), (D0, D1, dec_tbl)]:
        if a in head and b_ in head:
            head = head.split(a)[0] + a + "\n" + t + "\n" + b_ + head.split(b_)[1]
    path.write_text(head.rstrip("\n") + "\n\n" + AUTO + "\n\n" + body + "\n")
    print(lvl_tbl)
    print()
    print(dec_tbl)


DEFAULT_HEAD = f"""# Level and decomposition (2026-09-19)

(top section not written yet)

{T0}
{T1}

{D0}
{D1}
"""

METHOD = """
## Method, settings, leakage notes

Run order: `uv run pretrain.py` (training-period fits), `uv run run.py` (walk-forward predictions),
`uv run report.py` (this file). Everything is offline: the only inputs are the parquet files in
`../2026_09_18_outcome_screen/data/`, read through that folder's own `load()` and `build()`. No database,
no LLM, no external API, and nothing is written outside this folder.

- **Walk-forward.** One refit per UTC calendar day D of submit time; a fit on day D sees only notes with
  submitted_at < D - 7 days. Identical to the prior backtest, and verified identical: `prior_all`,
  `prior_30d` and `stable4` were recomputed here and match the prior run's `predictions.parquet` exactly.
- **`prior_all` / `prior_30d`.** Rate over the whole `notes` table (8,808 rows, back to 2025-10-10) with
  submitted_at < D - 7d; `prior_30d` restricts to the latest 30 label-available days and shrinks by 50
  pseudo-notes of `prior_all`.
- **`ewma_hlX`.** Same history, each note weighted 2^(-age / X days) with age measured from the label
  horizon, shrunk by the same 50 pseudo-notes. Implemented as an exponentially weighted mean of the
  outcome - equivalently the MLE of an intercept-only weighted logistic regression, which is what "on the
  logit scale" means for a binary outcome. It was **not** implemented as an average of daily logits: that
  is a geometric-odds mean, biased downwards by Jensen whenever daily rates are dispersed, which would have
  flattered a forecaster whose whole job here is to chase a falling level. Only the one definition was run.
- **`ewma_sel`.** Whichever half-life the pre-registered rule picked; it is a copy of that row, kept
  separate so the headline is unambiguous.
- **`ewma_auto`.** Re-picks the half-life every refit day, by Brier over every note submitted from
  2026-07-01 up to that day's label horizon, each scored against its own day's walk-forward level. Legal
  (nothing after D - 7d is used) but it is an extra, not the pre-registered headline.
- **`local_linear_trend` / `smooth_trend`.** Kalman filter on the daily logit of the outcome rate over the
  full note history, diffuse prior, Haldane-corrected observations with binomial variances, missing days as
  prediction-only steps. Variances estimated by MLE on days before 2026-08-16 and then fixed. The forecast
  filters up to the label horizon and projects level + steps x slope forward to day D (8 days, sometimes 9
  or 10 after the Aug 21-22 gap).
- **`stable4_lvl_*`.** The stable4 logistic is fitted exactly as before, then every logit is shifted by the
  single constant that makes the mean fitted probability **over the training rows** equal the level
  forecast. Training features only, so the swap uses nothing from the test day.
- **Two-stage.** P(rated) and P(H | rated) fitted separately on the same training rows; the conditional
  factor trains only on rated notes (101 to 250 of them over the scored days). Its level is the 30-day
  conditional rate shrunk to the all-history conditional by 100 pseudo-notes, and its feature slopes are
  a C=0.1 logistic's centred linear predictor multiplied by n_rated / (n_rated + 200), which ran 0.34 to
  0.56. P(NH) = P(rated) x (1 - P(H | rated)); rated is H + NH by construction, so the two conditional
  factors are complementary by definition.

Honesty and residual risks:

1. **Multiplicity.** This run computes 3 targets x 20 forecasters = 60 rows, each with a note-level and a
   day-block interval. At 5% a handful will exclude zero by chance. Nothing here is corrected for that, and
   the pre-registered headline is named in advance precisely so the grid cannot be mined after the fact.
2. **The half-life grid is flat on the training period** (Brier spread 0.00009 across 7/14/30/60 days), so
   the selection rule is close to a coin flip between them. It picked 60 days; the narrow robustness set
   would have picked 7. Both are reported.
3. **`materiality_engages` could not be tested.** The brief asked for it as an extra feature. The offline
   pull (`../2026_09_18_outcome_screen/pull.py`) selected `pipeline_scores` with
   `score_type = 'evaluation'` only, so no `materiality_engages` row exists on disk, and connecting to the
   database was out of scope for this run. `pipeline_runs.ab_test_picks` carries a `materiality_treatment`
   arm on 282 of 2,167 runs, but that is the A/B assignment, not the judge's per-note binary verdict, so it
   is not a substitute. Re-pulling that score type is a one-line change to the sibling pull script and the
   feature split below should be redone with it.
4. **Labels are today's status.** Training labels, the priors and the author-history feature all use
   cn_status at pull time, inherited from the prior run. The screen measured 99.5% of statuses final by day
   7, so this is small but not zero.
5. **Bootstrap intervals treat notes as independent.** Notes share a daily fit and a news cycle; the
   day-block interval is shown alongside and is the one to believe.
6. **The descriptive coefficient table is in-sample** over all 2,026 matured window notes, including the
   977 scored ones. It is a description of where the signal sits, not evidence that it forecasts.
"""

if __name__ == "__main__":
    main()
