# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""Walk-forward run for both jobs. OFFLINE; reads only ../2026_09_18_outcome_screen/data.

Job 1  level forecasters: prior_all, prior_30d, ewma_logit at four pre-registered
       half-lives, the pre-registered pick, a daily self-selecting variant, a local
       linear trend and a smooth-trend Kalman filter, plus stable4 with its intercept
       swapped for each of those levels.
Job 2  decomposition: P(H) = P(rated) * P(H | rated) with the two factors fitted
       separately and the conditional factor shrunk hard toward the pooled conditional.

Writes data/predictions.parquet, data/level_by_day.csv, data/coefficients.json,
data/run_meta.json.  Run:  uv run pretrain.py  then  uv run run.py
"""
import json

import numpy as np
import pandas as pd

import common as C

PRE = json.loads((C.OUT / "pretrain.json").read_text())
SEL_HL = PRE["chosen_half_life"]
LEVELS = ["prior_all", "prior_30d"] + [f"ewma_hl{hl}" for hl in C.HALF_LIVES] + \
         ["ewma_sel", "ewma_auto", "local_linear_trend", "smooth_trend"]


# ---------------------------------------------------------------- level cache
def level_cache(hist, days):
    """Level forecasts for every UTC day that might need one, under the lag rule.
    One row per (day, target); columns are the level forecasters that depend only on
    the outcome history. Used both by the main loop and by ewma_auto's self-selection."""
    out = {}
    when, arr = hist["when"], {tg: hist[tg].values for tg in C.TARGETS}
    dc = {tg: C.daily_counts(when, arr[tg]) for tg in C.TARGETS}
    for D in days:
        horizon = D - C.LAG
        m = (when < horizon).values
        if m.sum() < 200:
            continue
        hw, n_h = when[m], int(m.sum())
        m30 = m & (when >= horizon - C.PRIOR_WINDOW).values
        for tg in C.TARGETS:
            y = arr[tg]
            p_all = float(y[m].mean())
            r = {"prior_all": p_all,
                 "prior_30d": C.shrunk_mean(float(y[m30].sum()), int(m30.sum()), p_all, C.PRIOR_SHRINK_M),
                 "n_hist": n_h, "n_30d": int(m30.sum())}
            for hl in C.HALF_LIVES:
                r[f"ewma_hl{hl}"] = C.ewma_level(hw, y[m], horizon, hl, p_all)
            r["ewma_sel"] = r[f"ewma_hl{SEL_HL}"]
            # conditional factor: P(target | rated) over rated notes only
            mr = m & (arr["rated"] == 1)
            if tg in ("H", "NH") and mr.sum() >= 20:
                c_all = float(y[mr].sum() / mr.sum())
                mr30 = mr & (when >= horizon - C.PRIOR_WINDOW).values
                r["cond_all"] = c_all
                r["cond_30d"] = C.shrunk_mean(float(y[mr30].sum()), int(mr30.sum()), c_all, C.COND_SHRINK_M)
                for mm in C.COND_SHRINK_SENS:
                    r[f"cond_30d_m{mm}"] = C.shrunk_mean(float(y[mr30].sum()), int(mr30.sum()), c_all, mm)
                r["cond_ewma_sel"] = C.ewma_level(when[mr], y[mr], horizon, SEL_HL, c_all, m=C.COND_SHRINK_M)
                r["n_rated_30d"] = int(mr30.sum())
            for nm, par in [("local_linear_trend", PRE["llt"][tg]), ("smooth_trend", PRE["smooth_trend"][tg])]:
                d_, n_, k_ = dc[tg]
                p, lvl, slp, steps = C.llt_forecast(d_, n_, k_, horizon, D, par["q_level"], par["q_slope"],
                                                    np.array(par["a0"]))
                r[nm] = p
                r[nm + "_state"] = (lvl, slp, steps)
            out[(D, tg)] = r
    return out


def auto_pick(cache, hist, D, tg):
    """Daily self-selection: at refit day D pick the half-life with the lowest Brier over
    every note submitted from SELECT_START up to the label horizon, each scored against
    that note's own day's walk-forward level. Legal: nothing after D - 7d is used."""
    horizon = D - C.LAG
    m = ((hist["when"] >= C.SELECT_START) & (hist["when"] < horizon)).values
    if m.sum() < 200:
        return f"ewma_hl{SEL_HL}", np.nan
    days = hist["when"][m].dt.floor("D")
    y = hist[tg].values[m]
    best, bb = None, np.inf
    for hl in C.HALF_LIVES:
        key = f"ewma_hl{hl}"
        p = days.map(lambda d: cache.get((d, tg), {}).get(key, np.nan)).values
        ok = ~np.isnan(p)
        if ok.sum() < 200:
            continue
        b = float(((p[ok] - y[ok]) ** 2).mean())
        if b < bb:
            best, bb = key, b
    return (best or f"ewma_hl{SEL_HL}"), bb


# ---------------------------------------------------------------- main
def main():
    C.OUT.mkdir(exist_ok=True)
    meta, pulled_at, cutoff, notes_all, df, hist = C.get_data()
    X = C.features(df)

    need = pd.date_range(C.SELECT_START, df["when"].max().floor("D"), freq="D")
    cache = level_cache(hist, need)
    print(f"level cache: {len(cache)} (day, target) entries")

    rows, daylog, coefs = [], [], []
    for D, horizon, te, tr, scored in C.schedule(df):
        note_id, sub = df.loc[te, "note_id"].values, df.loc[te, "when"].array
        log = dict(day=str(D.date()), n_test=len(te), n_train=len(tr), scored=bool(scored))

        def emit(name, tg, p):
            p = np.clip(np.asarray(p, dtype=float), *C.PRED_CLIP)
            rows.append(pd.DataFrame({"note_id": note_id, "submitted_at": sub, "refit_day": D,
                                      "scored": scored, "n_train": len(tr), "forecaster": name,
                                      "target": tg, "y": df.loc[te, tg].values, "p": p}))

        for tg in C.TARGETS:
            cc = cache[(D, tg)]
            ytr = df.loc[tr, tg].values
            log[f"train_pos_{tg}"] = int(ytr.sum())
            for nm in ["prior_all", "prior_30d"] + [f"ewma_hl{hl}" for hl in C.HALF_LIVES] + ["ewma_sel"]:
                log[f"{nm}_{tg}"] = cc[nm]
                emit(nm, tg, np.full(len(te), cc[nm]))
            pick, _ = auto_pick(cache, hist, D, tg)
            log[f"auto_pick_{tg}"] = pick
            log[f"ewma_auto_{tg}"] = cc[pick]
            emit("ewma_auto", tg, np.full(len(te), cc[pick]))
            for nm in ["local_linear_trend", "smooth_trend"]:
                v = cc[nm] if np.isfinite(cc[nm]) else cc["prior_30d"]
                lvl, slp, steps = cc[nm + "_state"]
                log[f"{nm}_{tg}"] = v
                log[f"{nm}_slope_{tg}"] = slp
                log[f"{nm}_steps_{tg}"] = steps
                emit(nm, tg, np.full(len(te), v))

            # ---- one-stage feature model (stable4), recomputed, plus level swaps ----
            if ytr.sum() >= C.MIN_POS:
                a, b = C.prep(X.loc[tr], X.loc[te], C.STABLE4)
                p, eta_tr, eta_te, m = C.fit_logit(a, ytr, b)
                emit("stable4", tg, p)
                for lv in ["ewma_sel", "local_linear_trend", "smooth_trend"]:
                    tgt = cc[lv] if np.isfinite(cc[lv]) else cc["prior_30d"]
                    emit(f"stable4_lvl_{lv}", tg, C.swap_level(eta_tr, eta_te, tgt))
                if scored:
                    coefs.append(dict(day=str(D.date()), factor=f"one_stage_{tg}", n=len(tr),
                                      pos=int(ytr.sum()), intercept=float(m.intercept_[0]),
                                      **{c: float(v) for c, v in zip(C.STABLE4, m.coef_[0])}))
            else:
                emit("stable4", tg, np.full(len(te), cc["prior_30d"]))
                for lv in ["ewma_sel", "local_linear_trend", "smooth_trend"]:
                    emit(f"stable4_lvl_{lv}", tg, np.full(len(te), cc[lv] if np.isfinite(cc[lv]) else cc["prior_30d"]))

        # ------------------------------------------------ Job 2: two-stage
        cH, cNH, cR = cache[(D, "H")], cache[(D, "NH")], cache[(D, "rated")]
        ytr_r = df.loc[tr, "rated"].values
        tr_rated = tr[ytr_r == 1]
        n_rated = len(tr_rated)
        log["n_train_rated"] = n_rated
        log["cond_30d_H"] = cH.get("cond_30d", np.nan)
        log["cond_all_H"] = cH.get("cond_all", np.nan)

        # (a) level-only two-stage, with the conditional factor shrunk to the pooled rate
        for nm, rlev, clev in [("two_prior", cR["prior_30d"], cH.get("cond_30d")),
                               ("two_prior_m50", cR["prior_30d"], cH.get("cond_30d_m50")),
                               ("two_prior_m200", cR["prior_30d"], cH.get("cond_30d_m200")),
                               ("two_ewma", cR["ewma_sel"], cH.get("cond_ewma_sel"))]:
            if clev is None:
                continue
            emit(nm, "rated", np.full(len(te), rlev))
            emit(nm, "H", np.full(len(te), rlev * clev))
            emit(nm, "NH", np.full(len(te), rlev * (1 - clev)))
            log[f"{nm}_rated"], log[f"{nm}_cond"] = rlev, clev

        # (b) feature two-stage: features on both factors, conditional slopes shrunk
        if ytr_r.sum() >= C.MIN_POS:
            a, b = C.prep(X.loc[tr], X.loc[te], C.STABLE4)
            p_rated, eta_tr_r, eta_te_r, m_r = C.fit_logit(a, ytr_r, b)
            if scored:
                coefs.append(dict(day=str(D.date()), factor="rated", n=len(tr), pos=int(ytr_r.sum()),
                                  intercept=float(m_r.intercept_[0]),
                                  **{c: float(v) for c, v in zip(C.STABLE4, m_r.coef_[0])}))
        else:
            p_rated, eta_tr_r, eta_te_r = np.full(len(te), cR["prior_30d"]), None, None

        yc = df.loc[tr_rated, "H"].values
        lam, eta_c = 0.0, np.zeros(len(te))
        if n_rated >= 30 and yc.sum() >= C.MIN_POS and (len(yc) - yc.sum()) >= C.MIN_POS:
            a2, b2 = C.prep(X.loc[tr_rated], X.loc[te], C.STABLE4)
            _, eta_tr_c, eta_te_c, m_c = C.fit_logit(a2, yc, b2, C=C.COND_C)
            lam = n_rated / (n_rated + C.COND_LAMBDA_K)
            eta_c = lam * (eta_te_c - eta_tr_c.mean())
            if scored:
                coefs.append(dict(day=str(D.date()), factor="H_given_rated", n=n_rated, pos=int(yc.sum()),
                                  intercept=float(m_c.intercept_[0]), shrink_lambda=lam,
                                  **{c: float(v) for c, v in zip(C.STABLE4, m_c.coef_[0])}))
        log["cond_lambda"] = lam

        if cH.get("cond_30d") is not None:
            p_cond = C.sigmoid(C.logit(cH["cond_30d"]) + eta_c)
            emit("two_stable4", "rated", p_rated)
            emit("two_stable4", "H", p_rated * p_cond)
            emit("two_stable4", "NH", p_rated * (1 - p_cond))
            r_lvl = (C.swap_level(eta_tr_r, eta_te_r, cR["ewma_sel"]) if eta_tr_r is not None
                     else np.full(len(te), cR["ewma_sel"]))
            p_cond2 = C.sigmoid(C.logit(cH["cond_ewma_sel"]) + eta_c)
            emit("two_stable4_lvl", "rated", r_lvl)
            emit("two_stable4_lvl", "H", r_lvl * p_cond2)
            emit("two_stable4_lvl", "NH", r_lvl * (1 - p_cond2))
        daylog.append(log)

    pred = pd.concat(rows, ignore_index=True)
    pred.to_parquet(C.OUT / "predictions.parquet")
    pd.DataFrame(daylog).to_csv(C.OUT / "level_by_day.csv", index=False)
    pd.DataFrame(coefs).to_csv(C.OUT / "walk_forward_coefficients.csv", index=False)

    sc = pred[pred["scored"]]
    base = sc[(sc["forecaster"] == "prior_30d") & (sc["target"] == "H")]
    out_meta = dict(pulled_at_utc=str(pulled_at), maturity_cutoff_utc=str(cutoff),
                    n_matured_window_notes=int(len(df)), n_scored=int(base["note_id"].nunique()),
                    scored_first_submit=str(sc["submitted_at"].min()), scored_last_submit=str(sc["submitted_at"].max()),
                    positives={tg: int(sc[(sc["forecaster"] == "prior_30d") & (sc["target"] == tg)]["y"].sum())
                               for tg in C.TARGETS},
                    selected_half_life=SEL_HL, pretrain=PRE["llt"], smooth_trend=PRE["smooth_trend"],
                    settings=dict(lag_days=7, half_lives=C.HALF_LIVES, cond_shrink_m=C.COND_SHRINK_M,
                                  cond_lambda_k=C.COND_LAMBDA_K, cond_C=C.COND_C,
                                  prior_window_days=30, prior_shrink_m=C.PRIOR_SHRINK_M, logit_C=C.LOGIT_C),
                    forecasters=sorted(pred["forecaster"].unique().tolist()), days=daylog)
    C.write_json(C.OUT / "run_meta.json", out_meta)
    print(json.dumps({k: v for k, v in out_meta.items() if k != "days"}, indent=2, default=float)[:2000])
    print(pred[pred["scored"]].groupby(["forecaster", "target"]).size().unstack().to_string())


if __name__ == "__main__":
    main()
