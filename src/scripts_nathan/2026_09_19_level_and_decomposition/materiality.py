# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""Addendum: does the materiality judge's verdict change anything?

OFFLINE once `uv run pull_materiality.py` has written data/materiality_scores.parquet.
Adds `materiality_engages` (binary) and `materiality_overall` (continuous) to the
stable4 feature set, reruns the walk-forward on the identical 977 scored notes under
the identical rules, redoes the job-2 feature split, and appends a marked section to
RESULTS.md. The original sections are left untouched.

`source_verification` is checked for variance first and dropped if it is constant.

Run:  uv run pull_materiality.py && uv run materiality.py
"""
import json

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

import common as C
import report as R

SCORES = C.OUT / "materiality_scores.parquet"
MARK = "<!-- MATERIALITY-ADDENDUM (materiality.py); regenerated in full -->"
WANT = ["materiality_overall", "materiality_engages", "materiality_convince",
        "materiality_takeaway", "source_verification"]
# stable4 plus the two new columns and their missing flags
MAT = C.STABLE4 + ["mat_engages", "mat_overall", "mat_missing"]
MAT_CONT = C.CONT + ["mat_overall"]
NEW = ["stable4_mat", "stable4_mat_lvl_ewma_sel", "two_stable4_mat_lvl"]
COMPARE = ["prior_30d", "ewma_sel", "stable4", "stable4_lvl_ewma_sel", "two_stable4_lvl"]


def load_scores():
    if not SCORES.exists():
        raise SystemExit(f"{SCORES} is missing. Run `uv run pull_materiality.py` first "
                         "(one read-only pull; it needs the Production Reads permission).")
    sc = pd.read_parquet(SCORES)
    piv = sc.pivot_table(index="run_id", columns="score_type", values="score_value", aggfunc="last")
    for c in WANT:
        if c not in piv.columns:
            piv[c] = np.nan
    return sc, piv[WANT]


def variance_table(piv, df, scored_ids):
    """Per score type: coverage and spread, on all matured window notes and on the 977."""
    hit = pd.DataFrame(index=df["note_id"])
    for c in WANT:
        hit[c] = df["run_id"].map(piv[c]).values
    rows = []
    for c in WANT:
        v = hit[c]
        vs = hit.loc[hit.index.isin(scored_ids), c]
        rows.append(dict(score_type=c, n_window=int(v.notna().sum()), pct_window=v.notna().mean(),
                         n_scored=int(vs.notna().sum()), pct_scored=vs.notna().mean(),
                         distinct=int(v.dropna().nunique()), vmin=v.min(), vmax=v.max(),
                         mean=v.mean(), sd=v.std()))
    return pd.DataFrame(rows), hit


def main():
    sc_raw, piv = load_scores()
    meta = json.loads((C.OUT / "run_meta.json").read_text())
    old = pd.read_parquet(C.OUT / "predictions.parquet")
    scored_ids = set(old[old["scored"] & (old["forecaster"] == "prior_30d") &
                         (old["target"] == "H")]["note_id"])

    _, _, _, _, df, _ = C.get_data()
    # map run_id -> score, then note -> score
    lut = {c: piv[c] for c in WANT}
    hit = pd.DataFrame({c: df["run_id"].map(lut[c]).values for c in WANT}, index=df["note_id"])
    vt, _ = variance_table(piv, df, scored_ids)

    dropped = [r.score_type for _, r in vt.iterrows() if r.distinct <= 1 or r.n_window == 0]
    X = C.features(df)
    eng = hit["materiality_engages"].values
    ovr = hit["materiality_overall"].values
    X["mat_engages"] = eng
    X["mat_overall"] = ovr
    X["mat_missing"] = np.isnan(eng).astype(float)

    # ---------------- walk-forward, identical rules, extended feature set ----------------
    lvl = pd.read_csv(C.OUT / "level_by_day.csv")
    lvl["day"] = pd.to_datetime(lvl["day"]).dt.tz_localize("UTC")
    lvl = lvl.set_index("day")
    rows = []
    coefs = []
    for D, horizon, te, tr, scored in C.schedule(df):
        L = lvl.loc[D]
        note_id, sub = df.loc[te, "note_id"].values, df.loc[te, "when"].array

        def emit(name, tg, p):
            rows.append(pd.DataFrame({"note_id": note_id, "submitted_at": sub, "refit_day": D,
                                      "scored": scored, "forecaster": name, "target": tg,
                                      "y": df.loc[te, tg].values,
                                      "p": np.clip(np.asarray(p, float), *C.PRED_CLIP)}))

        for tg in C.TARGETS:
            ytr = df.loc[tr, tg].values
            if ytr.sum() >= C.MIN_POS:
                a, b = C.prep(X.loc[tr], X.loc[te], MAT, MAT_CONT)
                p, eta_tr, eta_te, m = C.fit_logit(a, ytr, b)
                emit("stable4_mat", tg, p)
                emit("stable4_mat_lvl_ewma_sel", tg, C.swap_level(eta_tr, eta_te, L[f"ewma_sel_{tg}"]))
                if scored:
                    coefs.append(dict(day=str(D.date()), factor=f"one_stage_{tg}", n=len(tr),
                                      pos=int(ytr.sum()), intercept=float(m.intercept_[0]),
                                      **{c: float(v) for c, v in zip(MAT, m.coef_[0])}))
            else:
                emit("stable4_mat", tg, np.full(len(te), L[f"prior_30d_{tg}"]))
                emit("stable4_mat_lvl_ewma_sel", tg, np.full(len(te), L[f"ewma_sel_{tg}"]))

        # two-stage with the extended features, same shrinkage as before
        ytr_r = df.loc[tr, "rated"].values
        tr_rated = tr[ytr_r == 1]
        n_rated = len(tr_rated)
        if ytr_r.sum() >= C.MIN_POS:
            a, b = C.prep(X.loc[tr], X.loc[te], MAT, MAT_CONT)
            _, eta_tr_r, eta_te_r, m_r = C.fit_logit(a, ytr_r, b)
            r_lvl = C.swap_level(eta_tr_r, eta_te_r, L["ewma_sel_rated"])
            if scored:
                coefs.append(dict(day=str(D.date()), factor="rated", n=len(tr), pos=int(ytr_r.sum()),
                                  intercept=float(m_r.intercept_[0]),
                                  **{c: float(v) for c, v in zip(MAT, m_r.coef_[0])}))
        else:
            r_lvl = np.full(len(te), L["ewma_sel_rated"])

        yc = df.loc[tr_rated, "H"].values
        eta_c = np.zeros(len(te))
        if n_rated >= 30 and yc.sum() >= C.MIN_POS and (len(yc) - yc.sum()) >= C.MIN_POS:
            a2, b2 = C.prep(X.loc[tr_rated], X.loc[te], MAT, MAT_CONT)
            _, eta_tr_c, eta_te_c, m_c = C.fit_logit(a2, yc, b2, C=C.COND_C)
            lam = n_rated / (n_rated + C.COND_LAMBDA_K)
            eta_c = lam * (eta_te_c - eta_tr_c.mean())
            if scored:
                coefs.append(dict(day=str(D.date()), factor="H_given_rated", n=n_rated, pos=int(yc.sum()),
                                  intercept=float(m_c.intercept_[0]), shrink_lambda=lam,
                                  **{c: float(v) for c, v in zip(MAT, m_c.coef_[0])}))
        p_cond = C.sigmoid(C.logit(L["two_ewma_cond"]) + eta_c)
        emit("two_stable4_mat_lvl", "rated", r_lvl)
        emit("two_stable4_mat_lvl", "H", r_lvl * p_cond)
        emit("two_stable4_mat_lvl", "NH", r_lvl * (1 - p_cond))

    new = pd.concat(rows, ignore_index=True)
    new.to_parquet(C.OUT / "predictions_materiality.parquet")
    pd.DataFrame(coefs).to_csv(C.OUT / "walk_forward_coefficients_materiality.csv", index=False)

    # ---------------- score, identical machinery ----------------
    keep = old[old["forecaster"].isin(COMPARE)][["note_id", "scored", "refit_day", "target", "y", "p", "forecaster"]]
    allp = pd.concat([keep, new[["note_id", "scored", "refit_day", "target", "y", "p", "forecaster"]]],
                     ignore_index=True)
    s = allp[allp["scored"]].copy()
    s["p"] = s["p"].clip(*C.CLIP)
    order = COMPARE + NEW
    wide, ys = {}, {}
    for tg in C.TARGETS:
        g = s[s["target"] == tg]
        w = g.pivot(index="note_id", columns="forecaster", values="p")[order]
        assert not w.isna().any().any()
        mg = g[g["forecaster"] == "prior_30d"].set_index("note_id").loc[w.index]
        wide[tg], ys[tg] = w, mg["y"].values.astype(float)
        days = mg["refit_day"].values
    n = len(wide["H"])
    assert n == meta["n_scored"] and set(wide["H"].index) == scored_ids

    rng = np.random.default_rng(R.SEED)
    idx = rng.integers(0, n, size=(R.N_BOOT, n))
    uday, dcode = np.unique(days, return_inverse=True)
    didx = rng.integers(0, len(uday), size=(R.N_BOOT, len(uday)))

    def contrast(tg, a_, b_):
        y = ys[tg]
        pa, pb = wide[tg][a_].values, wide[tg][b_].values
        d = (pa - y) ** 2 - (pb - y) ** 2
        dll = (-(y * np.log(pa) + (1 - y) * np.log(1 - pa))) - (-(y * np.log(pb) + (1 - y) * np.log(1 - pb)))
        lo, hi = np.quantile(d[idx].mean(axis=1), [0.025, 0.975])
        ds = np.bincount(dcode, weights=d, minlength=len(uday))
        dc = np.bincount(dcode, minlength=len(uday)).astype(float)
        dlo, dhi = np.quantile(ds[didx].sum(axis=1) / dc[didx].sum(axis=1), [0.025, 0.975])
        return d.mean(), lo, hi, dlo, dhi, dll.mean()

    o = [MARK, "", "## Addendum: the materiality judge's scores (2026-09-19, second pass)", ""]
    o.append(f"One extra read-only pull fetched {', '.join(WANT)} for the {meta['n_matured_window_notes']} "
             "matured window notes' pipeline runs (three columns, id-list lookups, read-only transaction, "
             "60 s timeout, one pass). Everything else is unchanged: identical 977 scored notes, identical "
             "walk-forward, identical bootstraps.\n")

    o.append("### Coverage and variance (the drop test)\n")
    o.append("| score type | rows on window notes | on the 977 scored | distinct values | min | max | mean | sd |")
    o.append("|---|---|---|---|---|---|---|---|")
    for _, r in vt.iterrows():
        o.append(f"| `{r.score_type}` | {r.n_window} ({R.pc(r.pct_window, 1)}) | {r.n_scored} ({R.pc(r.pct_scored, 1)}) | "
                 f"{r.distinct} | {r.vmin:.4g} | {r.vmax:.4g} | {r.mean:.4g} | {r.sd:.4g} |")
    o.append("")
    if dropped:
        o.append(f"**Dropped for having no variance (or no rows): {', '.join('`' + d + '`' for d in dropped)}.**")
    o.append(f"Only `materiality_engages` and `materiality_overall` enter the models, as briefed. "
             f"`materiality_convince` and `materiality_takeaway` were pulled for the variance check and are "
             f"not used.\n")

    o.append("### Raw contingency: does `materiality_engages` split attention or quality?\n")
    e = hit["materiality_engages"]
    dd = df.copy()
    dd["eng"] = e.values
    o.append("| engages | n | rated at all | H | NH | H / (H+NH) |")
    o.append("|---|---|---|---|---|---|")
    for v, gg in dd.groupby(dd["eng"].fillna(-1)):
        lab = {1.0: "1 (yes)", 0.0: "0 (no)", -1.0: "missing"}.get(float(v), str(v))
        r_ = gg["rated"].mean()
        cond = gg["H"].sum() / gg["rated"].sum() if gg["rated"].sum() else np.nan
        o.append(f"| {lab} | {len(gg)} | {R.pc(r_, 1)} | {R.pc(gg['H'].mean(), 1)} | "
                 f"{R.pc(gg['NH'].mean(), 1)} | {R.pc(cond, 1)} |")
    o.append("")

    o.append("### Out-of-sample: does it move the Brier picture?\n")
    o.append(f"Identical {n} notes. Differences are the row minus the named reference, negative is better.\n")
    o.append("| target | forecaster | Brier | vs `prior_30d` [note boot 95%] | excl. 0? | vs `ewma_sel` [note boot 95%] "
             "| excl. 0? | mean pred / observed | log loss | AUC |")
    o.append("|---|---|---|---|---|---|---|---|---|---|")
    for tg in C.TARGETS:
        y = ys[tg]
        for fc in order:
            p = wide[tg][fc].values
            br = ((p - y) ** 2).mean()
            ll = float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())
            auc = roc_auc_score(y, p) if np.ptp(p) > 0 else np.nan
            c1 = "ref | - " if fc == "prior_30d" else None
            if c1 is None:
                m1, lo1, hi1, _, _, _ = contrast(tg, fc, "prior_30d")
                c1 = f"{R.s5(m1)} [{R.s5(lo1)}, {R.s5(hi1)}] | {R.verdict(lo1, hi1)} "
            if fc == "ewma_sel":
                c2 = "ref | - "
            else:
                m2, lo2, hi2, _, _, _ = contrast(tg, fc, "ewma_sel")
                c2 = f"{R.s5(m2)} [{R.s5(lo2)}, {R.s5(hi2)}] | {R.verdict(lo2, hi2)} "
            o.append(f"| {tg} | `{fc}` | {R.f5(br)} | {c1}| {c2}| {R.pc(p.mean())} / {R.pc(y.mean())} | "
                     f"{ll:.4f} | {'n/a' if np.isnan(auc) else f'{auc:.3f}'} |")
    o.append("")

    o.append("### Does adding materiality help the model it was added to?\n")
    o.append("| target | contrast | Brier diff [note boot 95%] | excl. 0? | Brier diff [day block 95%] | excl. 0? | log loss diff |")
    o.append("|---|---|---|---|---|---|---|")
    for tg in C.TARGETS:
        for a_, b_ in [("stable4_mat", "stable4"), ("stable4_mat_lvl_ewma_sel", "stable4_lvl_ewma_sel"),
                       ("two_stable4_mat_lvl", "two_stable4_lvl")]:
            m_, lo, hi, dlo, dhi, dll = contrast(tg, a_, b_)
            o.append(f"| {tg} | `{a_}` vs `{b_}` | {R.s5(m_)} [{R.s5(lo)}, {R.s5(hi)}] | {R.verdict(lo, hi)} | "
                     f"[{R.s5(dlo)}, {R.s5(dhi)}] | {R.verdict(dlo, dhi)} | {dll:+.4f} |")
    o.append("")

    o.append("### Feature split, redone with materiality\n")
    o.append("Descriptive, in-sample over all matured window notes, continuous features standardised within each "
             "fitting sample. The question is which column the engages flag loads on.\n")
    fits = descriptive(df, X)
    fits.to_csv(C.OUT / "descriptive_coefficients_materiality.csv", index=False)
    cols = ["P(rated), all notes", "P(H | rated), rated notes only", "P(H), all notes (one stage)",
            "P(NH), all notes (one stage)"]
    piv2 = fits.pivot(index="feature", columns="factor", values=["coef", "z"])
    o.append("| feature | " + " | ".join(c.replace("|", "\\|") for c in cols) + " |")
    o.append("|---|---|---|---|---|")
    for f_ in ["(intercept)"] + MAT:
        o.append(f"| `{f_}` | " + " | ".join(
            f"{piv2.loc[f_, ('coef', c)]:+.3f} (z {piv2.loc[f_, ('z', c)]:+.1f})" for c in cols) + " |")
    o.append("")
    wf = pd.read_csv(C.OUT / "walk_forward_coefficients_materiality.csv")
    g = wf.groupby("factor")[["intercept"] + MAT].mean()
    o.append("Walk-forward coefficients (mean over the 20 scored refit days, L2-penalised):\n")
    o.append("| factor | " + " | ".join(f"`{c}`" for c in ["intercept"] + MAT) + " |")
    o.append("|---|" + "---|" * (len(MAT) + 1))
    for f_, rr in g.iterrows():
        o.append(f"| `{f_}` | " + " | ".join(f"{rr[c]:+.3f}" for c in ["intercept"] + MAT) + " |")

    o.append("\n### Interval budget\n")
    n_new = len(C.TARGETS) * (len(order) * 2 + 3 * 2)
    o.append(f"This addendum adds roughly {n_new} more intervals on top of the 120 in the main run. Nothing is "
             "corrected for multiplicity. The pre-registered headline remains `ewma_sel` (EWMA, 60-day half-life); "
             "nothing here displaces it, and no result below was pre-registered - the engages effect was found "
             "post hoc by looking at four score types and reporting the one that separated, so it is a weak prior "
             "being tested, not an established effect.")
    o.append("\n### Leakage note\n")
    o.append("The pull was restricted to `pipeline_run_id, score_type, score_value`, so these scores carry no "
             "timestamp here and the before-submission check that was run for the evaluation score (minimum gap "
             "1.1 s) could not be repeated. The materiality judge runs inside `processTweet` before submission by "
             "construction (`src/pipeline/orchestration/materialityJudge.ts`), so the score is knowable at submit "
             "time, but that is an argument from the code path, not a check against the data.")

    body = "\n".join(o)
    path = C.HERE / "RESULTS.md"
    txt = path.read_text()
    txt = txt.split(MARK)[0].rstrip("\n")
    path.write_text(txt + "\n\n" + body + "\n")
    print(vt.to_string())
    print("\n".join(o[:4]))
    print(f"\nappended addendum to {path}")


def descriptive(df, X):
    Xs = X[MAT].copy()
    Xs = Xs.fillna(Xs.median().fillna(0.0))
    M = np.column_stack([np.ones(len(Xs)), Xs.values])
    rated = df["rated"].values == 1
    out = []
    jobs = [("P(rated), all notes", M, df["rated"].values.astype(float)),
            ("P(H | rated), rated notes only", M[rated], df["H"].values[rated].astype(float)),
            ("P(H), all notes (one stage)", M, df["H"].values.astype(float)),
            ("P(NH), all notes (one stage)", M, df["NH"].values.astype(float))]
    for name, Xm, y in jobs:
        Z = Xm.copy()
        for j, c in enumerate(MAT, start=1):
            if c in MAT_CONT:
                col = Z[:, j]
                Z[:, j] = (col - col.mean()) / (col.std() or 1.0)
        b, se = R.irls(Z, y)
        for j, c in enumerate(["(intercept)"] + MAT):
            out.append(dict(factor=name, n=len(y), pos=int(y.sum()), feature=c, coef=b[j], se=se[j],
                            z=b[j] / se[j] if se[j] > 0 else np.nan))
    return pd.DataFrame(out)


if __name__ == "__main__":
    main()
