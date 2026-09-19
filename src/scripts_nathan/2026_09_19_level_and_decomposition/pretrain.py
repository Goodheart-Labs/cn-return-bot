# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""Everything that is fitted BEFORE the test period, using only training-period labels.

Two things, both fixed afterwards and never revisited:

1. The EWMA half-life, chosen by the pre-registered rule in common.py: lowest Brier for
   target H over every note submitted 2026-07-01 <= t < 2026-08-16 UTC, each predicted
   walk-forward (daily refit, 7-day label lag). That whole set had resolved labels on
   the first scored refit day, so the choice sees no test-period outcome.
2. The local-linear-trend state variances, by maximum likelihood on the daily logit
   series of days strictly before 2026-08-16.

Writes data/pretrain.json.  Run:  uv run pretrain.py
"""
import numpy as np
import pandas as pd

import common as C


def walk_forward_levels(hist, sel):
    """EWMA level predictions for the selection notes, under the same lag rule."""
    rows = []
    for D, g in sel.groupby(sel["when"].dt.floor("D")):
        horizon = D - C.LAG
        h = hist[hist["when"] < horizon]
        if len(h) < 200:
            continue
        p_all = h["H"].mean()
        h30 = h[h["when"] >= horizon - C.PRIOR_WINDOW]
        row = {"prior_all": p_all,
               "prior_30d": C.shrunk_mean(h30["H"].sum(), len(h30), p_all, C.PRIOR_SHRINK_M)}
        for hl in C.HALF_LIVES:
            row[f"ewma_hl{hl}"] = C.ewma_level(h["when"], h["H"].values, horizon, hl, p_all)
        for name, p in row.items():
            rows.append(pd.DataFrame({"note_id": g["note_id"].values, "when": g["when"].values,
                                      "y": g["H"].values, "forecaster": name, "p": p}))
    return pd.concat(rows, ignore_index=True)


def main():
    C.OUT.mkdir(exist_ok=True)
    _, _, _, notes_all, _, hist = C.get_data()

    notes = notes_all.dropna(subset=["when"]).copy()
    sel = notes[(notes["when"] >= C.SELECT_START) & (notes["when"] < C.SELECT_END)]
    narrow = notes[(notes["when"] >= C.NARROW_START) & (notes["when"] < C.SELECT_END)]
    print(f"selection set: {len(sel)} notes, {int(sel['H'].sum())} H ({sel['H'].mean():.3%}), "
          f"{sel['when'].min()} to {sel['when'].max()}")
    print(f"narrow robustness set: {len(narrow)} notes, {int(narrow['H'].sum())} H ({narrow['H'].mean():.3%})")

    wf = walk_forward_levels(hist, sel)
    wf["brier"] = (wf["p"] - wf["y"]) ** 2
    nar = set(narrow["note_id"])
    tab = wf.groupby("forecaster").agg(n=("y", "size"), brier=("brier", "mean"),
                                       mean_p=("p", "mean"), obs=("y", "mean"))
    tab_nar = wf[wf["note_id"].isin(nar)].groupby("forecaster").agg(
        n=("y", "size"), brier=("brier", "mean"), mean_p=("p", "mean"), obs=("y", "mean"))
    print("\nPre-registered selection set (2026-07-01 to 2026-08-15):")
    print(tab.to_string())
    print("\nNarrow robustness set (2026-08-07 to 2026-08-15), NOT the headline rule:")
    print(tab_nar.to_string())

    cand = [f"ewma_hl{hl}" for hl in C.HALF_LIVES]
    order = sorted(cand, key=lambda k: (tab.loc[k, "brier"], -C.HALF_LIVES[cand.index(k)]))
    chosen = order[0]
    chosen_nar = min(cand, key=lambda k: tab_nar.loc[k, "brier"])
    print(f"\nPRE-REGISTERED CHOICE: {chosen}   (robustness set would have chosen {chosen_nar})")

    # --- local linear trend variances, per target, on the training daily series ---
    train = hist[hist["when"] < C.LLT_TRAIN_END]
    llt, smooth = {}, {}
    for tg in C.TARGETS:
        days, n, k = C.daily_counts(train["when"], train[tg].values)
        grid, y, v, obs = C._series(days, n, k)
        a0 = np.array([np.log(train[tg].mean() / (1 - train[tg].mean())), 0.0])
        base = dict(n_days=int(obs.sum()), a0=[float(a0[0]), 0.0],
                    first_day=str(pd.Timestamp(grid[0]).date()), last_day=str(pd.Timestamp(grid[-1]).date()))
        q_lvl, q_slp, ll = C.llt_fit(y, v, obs, a0)
        llt[tg] = dict(q_level=q_lvl, q_slope=q_slp, loglik=ll, **base)
        print(f"LLT          {tg}: q_level={q_lvl:.3e}  q_slope={q_slp:.3e}  loglik={ll:.2f}  days={int(obs.sum())}")
        s_lvl, s_slp, s_ll = C.smooth_trend_fit(y, v, obs, a0)
        smooth[tg] = dict(q_level=s_lvl, q_slope=s_slp, loglik=s_ll, **base)
        print(f"smooth_trend {tg}: q_level={s_lvl:.3e}  q_slope={s_slp:.3e}  loglik={s_ll:.2f}")

    C.write_json(C.OUT / "pretrain.json", dict(
        half_lives=C.HALF_LIVES, chosen=chosen, chosen_half_life=int(chosen.replace("ewma_hl", "")),
        chosen_narrow=chosen_nar,
        selection_set=dict(start=str(C.SELECT_START), end=str(C.SELECT_END), n=int(len(sel)),
                           H=int(sel["H"].sum()), rate=float(sel["H"].mean())),
        narrow_set=dict(start=str(C.NARROW_START), end=str(C.SELECT_END), n=int(len(narrow)),
                        H=int(narrow["H"].sum()), rate=float(narrow["H"].mean())),
        selection_table=tab.reset_index().to_dict("records"),
        narrow_table=tab_nar.reset_index().to_dict("records"),
        llt=llt, smooth_trend=smooth))
    print(f"\nwrote {C.OUT / 'pretrain.json'}")


if __name__ == "__main__":
    main()
