# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn", "joblib"]
# ///
"""Corpus-transfer experiment: can a model trained on OTHER authors' Community Notes
rank the outcomes of OUR notes?

OFFLINE. Reads ./data/*.parquet (pull.py), the prior backtest's predictions.parquet,
and — read-only, exactly as ../2026_09_18_forecast_baselines/forecast.py does — the
joins in ../2026_09_18_outcome_screen/screen.py for the stable4 features.

Writes ./data/*.parquet and the tables in RESULTS.md below the AUTO marker.
Run:  uv run run.py
"""
import json
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold

sys.dont_write_bytecode = True  # do not write __pycache__ into the sibling folders
warnings.filterwarnings("ignore", category=FutureWarning)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import (  # noqa: E402
    BASELINES, DATA, H, LAG, NH, NMR, RECAL_SPLIT, SETTINGS, WINDOW_START, Design,
    auc, boot_diff, brier, fit_logistic, groups_for, load, logit, logloss, run_variant, wilson,
)

MARKER = "<!-- AUTO-GENERATED BELOW THIS LINE BY run.py; edits below are overwritten -->"
NJOBS = 4
OUT = []


def w(s=""):
    OUT.append(s)


def pct(x, d=1):
    return "n/a" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{100 * x:.{d}f}%"


# =====================================================================================
# 1. Characterise the corpus
# =====================================================================================
def characterise(comp, ours, tweets):
    w("## 1. What the corpus actually is")
    w()
    cen = comp[comp["slice"] == "census"]
    mis = comp[comp["slice"] == "missed"]
    w(f"- `competing_notes` rows pulled: **{len(comp)}** ({comp['note_id'].nunique()} distinct "
      f"`note_id`, {comp['tweet_id'].nunique()} distinct `tweet_id`). `created_at_millis` runs "
      f"{comp['created'].min():%Y-%m-%d} to {comp['created'].max():%Y-%m-%d}.")
    w(f"- `first_seen_date` is populated on only {int(comp['first_seen_date'].notna().sum())} of "
      f"{len(comp)} rows, so every time cut below uses `created_at_millis` instead.")
    w()
    w("The table is filled by two different stages of `src/production/updateNoteFeedback.ts`, "
      "and they are not the same population:")
    w()
    w("| slice | how it is filled | rows | H | NH | NMR | null | H rate |")
    w("|---|---|---|---|---|---|---|---|")
    for name, g, how in [
        ("census (`our_note_id` set)", cen, "stage F: **every** other note on a tweet where our own note appears in the dump, whatever its status"),
        ("missed (`our_note_id` NULL)", mis, "stage G: notes on tweets our pipeline **rejected**, `filter(currentStatus === HELPFUL)`"),
    ]:
        nn = len(g)
        h = int((g["current_status"] == H).sum())
        nh = int((g["current_status"] == NH).sum())
        nm = int((g["current_status"] == NMR).sum())
        nu = int(g["current_status"].isna().sum())
        w(f"| {name} | {how} | {nn} | {h} | {nh} | {nm} | {nu} | {pct(h / nn)} |")
    w()
    h_all = int((comp["current_status"] == H).sum())
    w(f"**The headline 56% helpful is an artefact of stage G.** {len(mis)} of the {h_all} "
      f"CURRENTLY_RATED_HELPFUL rows ({pct(len(mis) / h_all)}) are missed-opportunity rows that are "
      f"helpful *by construction* — the code inserts no other status. Every NOT_HELPFUL and every "
      f"NEEDS_MORE_RATINGS row in the whole table sits in the census slice. Dropping stage G leaves "
      f"{len(cen)} notes at {pct((cen['current_status'] == H).mean())} helpful, which is the real "
      f"rate for notes written by other people on the tweets we note.")
    w()
    w(f"So the usable positive count is **{int((cen['current_status'] == H).sum())}**, not 14,724: "
      f"about {int((cen['current_status'] == H).sum()) / 227:.0f}x our own 227 rated-helpful notes, "
      f"not 60x. Everything below trains on the census slice only; the census+missed pool is fitted "
      f"once, in section 6, purely to show what it learns.")
    w()

    # status by note age
    now = pd.Timestamp(json.loads((DATA / "pull_meta.json").read_text())["pulled_at_utc"])
    c2 = cen.copy()
    c2["age_d"] = (now - c2["created"]).dt.total_seconds() / 86400
    bins = [0, 7, 14, 30, 60, 120, 240, 1e6]
    labs = ["0-7d", "7-14d", "14-30d", "30-60d", "60-120d", "120-240d", "240d+"]
    c2["ab"] = pd.cut(c2["age_d"], bins, labels=labs)
    w("### 1a. Status against note age (the maturity confound)")
    w()
    w("A note's `current_status` depends on how long it has been rated. If helpfulness rose "
      "steeply with age the model could learn 'old note' rather than 'good note'.")
    w()
    w("| age of note at pull | n | H | NH | NMR | null | H rate [Wilson 95%] |")
    w("|---|---|---|---|---|---|---|")
    for lab, g in c2.groupby("ab", observed=True):
        h = int((g["current_status"] == H).sum())
        lo, hi = wilson(h, len(g))
        w(f"| {lab} | {len(g)} | {h} | {int((g['current_status'] == NH).sum())} | "
          f"{int((g['current_status'] == NMR).sum())} | {int(g['current_status'].isna().sum())} | "
          f"{pct(h / len(g))} [{pct(lo)}, {pct(hi)}] |")
    w()
    w("The helpful rate is flat to within a few points from one week old to eight months old "
      "(Community Notes resolves in days, not months), so maturity is a small confound here, not "
      "the dominant one. Section 5 checks it again on the fitted scores.")
    w()

    # our slice vs our notes
    matured = ours[ours["cn_status"].notna() | True]
    w("### 1b. How the corpus differs from our own notes")
    w()
    rows = []
    cen_hn = cen[cen["current_status"].isin([H, NMR])]
    om = ours.copy()
    rows.append(("corpus census (H+NMR)", len(cen_hn), pct((cen_hn["current_status"] == H).mean()),
                 f"{cen_hn['note_text'].str.len().mean():.0f}",
                 f"{cen_hn['note_text'].fillna('').str.count('https?://').mean():.2f}"))
    rows.append(("our window notes (2026-08-07+)", len(om), pct(om["H"].mean()),
                 f"{om['note_text'].dropna().str.len().mean():.0f}",
                 f"{om['note_text'].fillna('').str.count('https?://').mean():.2f}"))
    w("| population | n | rated-helpful rate | mean note length (chars) | mean URLs per note |")
    w("|---|---|---|---|---|")
    for r in rows:
        w("| " + " | ".join(str(x) for x in r) + " |")
    w()
    w(f"- Tweet text found for {int(comp['tweet_text'].notna().sum())} of {len(comp)} corpus rows "
      f"({pct(comp['tweet_text'].notna().mean())}); "
      f"{int((comp['tweet_src'] == 'feed_tweets').sum())} rows from `feed_tweets`, "
      f"{int((comp['tweet_src'] == 'tweets').sum())} from the `tweets` fallback, "
      f"{int(comp['tweet_src'].isna().sum())} with no row in either.")
    w()
    w("**What population is this?** Notes written by other Community Notes contributors on the "
      "subset of tweets that (a) our feed surfaced, (b) our pipeline chose to note, and (c) X's "
      "public dump lists our note against. It is not a random sample of Community Notes. It is "
      "selected on the *tweet*, not on the note: conditional on a tweet being in it, every other "
      "author's note on that tweet is present with its true status. That is the property the "
      "within-tweet check in section 5 leans on.")
    w()
    return cen


# =====================================================================================
# 2. In-corpus models
# =====================================================================================
def make_target(cen, target, pool):
    # `pool` is either the string "census" or a DataFrame (census + the
    # missed-opportunity rows as extra positives: the trap).
    d = cen.copy() if isinstance(pool, str) else pool.copy()
    if target == "H_vs_NMR":
        d = d[d["current_status"].isin([H, NMR])].copy()
    else:
        d = d[d["current_status"].isin([H, NH])].copy()
    d["y"] = (d["current_status"] == H).astype(int)
    d["grp"] = groups_for(d)
    return d.reset_index(drop=True)


def cv_scores(d, variant, n_splits):
    gk = GroupKFold(n_splits=n_splits)
    folds = list(gk.split(d, d["y"], d["grp"]))
    res = Parallel(n_jobs=NJOBS)(
        delayed(lambda tr, te: run_variant(d.iloc[tr], d.iloc[te], variant)[0])(tr, te)
        for tr, te in folds)
    oof = np.zeros(len(d))
    fold_auc = []
    for (tr, te), p in zip(folds, res):
        oof[te] = p
        fold_auc.append(auc(d["y"].values[te], p))
    return oof, fold_auc


def time_split(d, variant):
    cut = d["created_at_millis"].quantile(SETTINGS["time_split_quantile"])
    tr, te = d[d["created_at_millis"] < cut], d[d["created_at_millis"] >= cut]
    p, m, des = run_variant(tr, te, variant)
    return p, te, tr, pd.to_datetime(cut, unit="ms", utc=True), m, des


def in_corpus(cen, comp):
    w("## 2. A text model on other authors' notes")
    w()
    w("Every transform (both TF-IDF vectorizers, the structural standardiser, the top-domain "
      "list, the SVD) is fitted on the training rows of each fold only. Two splits are reported "
      "for every row.")
    w()
    w(f"- **Tweet split**: `GroupKFold(n_splits={SETTINGS['group_kfold']})`. The group label is a "
      "union-find over `tweet_id` **and** an md5 of the note text, so neither two notes on the "
      "same tweet nor two copies of the same note text can straddle a fold. A plain random split "
      "would leak: 9,697 of the 13,751 census notes share a tweet with another census note.")
    w(f"- **Time split**: train on corpus notes below the {SETTINGS['time_split_quantile']:.0%} "
      "quantile of `created_at_millis`, test on the rest. Fixed rule, chosen before any result "
      "was seen.")
    w()
    pool_trap = comp.copy()
    configs = [
        ("note_tfidf", "H_vs_NMR", "census", "**PRIMARY** word(1,2)+char_wb(3,5) TF-IDF on note text, + 14 structural features, + top-30 domain flags"),
        ("note_no_urls", "H_vs_NMR", "census", "same, URLs stripped from the text and no domain flags (keeps the URL *count*)"),
        ("note_plus_tweet", "H_vs_NMR", "census", "primary + a word TF-IDF on the tweet the note answers"),
        ("struct_only", "H_vs_NMR", "census", "structural features + domain flags only, no n-grams"),
        ("lsa200", "H_vs_NMR", "census", "200-dim LSA of the same TF-IDF, heavily regularised (C=0.1) — the dense/'embedding' arm"),
        ("note_tfidf", "H_vs_NH", "census", "primary features, helpful vs NOT helpful"),
        ("note_tfidf", "H_vs_NMR", "trap", "primary features, but the missed-opportunity rows added as positives (**the trap**, section 6)"),
    ]
    rows, store = [], {}
    for variant, target, pool, desc in configs:
        d = make_target(cen, target, "census" if pool == "census" else pool_trap)
        t0 = time.time()
        oof, fold_auc = cv_scores(d, variant, SETTINGS["group_kfold"])
        p_t, te_t, tr_t, cut_t, m_t, des_t = time_split(d, variant)
        key = f"{variant}/{target}/{pool}"
        store[key] = dict(d=d, oof=oof, p_time=p_t, te_time=te_t, cut=cut_t, model=m_t, design=des_t)
        rows.append((key, desc, len(d), int(d["y"].sum()), auc(d["y"].values, oof),
                     np.nanmin(fold_auc), np.nanmax(fold_auc), len(tr_t), len(te_t),
                     int(te_t["y"].sum()), auc(te_t["y"].values, p_t), cut_t))
        print(f"  {key}: tweet-split AUC {rows[-1][4]:.3f}, time-split AUC {rows[-1][10]:.3f} "
              f"({time.time() - t0:.0f}s)")
    w("| model / target / pool | n | positives | AUC, tweet split (5-fold) | fold range | n train | n test | test pos | AUC, time split |")
    w("|---|---|---|---|---|---|---|---|---|")
    for k, desc, n, pos, a, lo, hi, ntr, nte, tpos, at, cut in rows:
        w(f"| `{k}` | {n} | {pos} | **{a:.3f}** | {lo:.3f}-{hi:.3f} | {ntr} | {nte} | {tpos} | **{at:.3f}** |")
    w()
    w("What each row is:")
    w()
    for (variant, target, pool, desc), r in zip(configs, rows):
        w(f"- `{r[0]}` — {desc}")
    w()
    w(f"Time split cut: {rows[0][11]:%Y-%m-%d} for the H-vs-NMR census pools.")
    w()
    return store


# =====================================================================================
# 3. Transfer to our notes
# =====================================================================================
def transfer(cen, ours):
    w("## 3. The transfer test")
    w()
    our_tweets = set(ours["tweet_id"])
    pool = cen[~cen["tweet_id"].isin(our_tweets)]
    pool = pool[pool["current_status"].isin([H, NMR])].copy()
    pool["y"] = (pool["current_status"] == H).astype(int)
    w(f"- **Training pool for every transfer model:** census rows whose tweet is **not** one of the "
      f"{len(our_tweets)} tweets our window notes sit on. That removes tweet-level contamination — "
      f"otherwise a competitor's note on the very tweet we are scoring would be in training, and "
      f"the shared topic words would leak. {len(cen)} census rows drop to "
      f"{len(cen[~cen['tweet_id'].isin(our_tweets)])}; restricted to H/NMR that is **{len(pool)}** "
      f"notes, {int(pool['y'].sum())} of them helpful ({pct(pool['y'].mean())}).")
    w("- Our own notes are never in `competing_notes` (the dump walk skips our author id; checked: "
      "0 of our 8,830 note ids appear there), so there is no note-level overlap either.")
    w()

    # ---- static fit (uses corpus notes created after our submit dates: not a legal forecast)
    tr = pool
    te = ours.copy()
    p_static, m_static, d_static = run_variant(tr, te, "note_tfidf")
    ours = ours.copy()
    ours["corpus_static"] = p_static

    # ---- walk-forward fit, one model per UTC submit day, corpus notes created < D - 7d
    days = sorted(ours["when"].dt.floor("D").unique())

    def one_day(D):
        trd = pool[pool["created"] < D - LAG]
        ted = ours[ours["when"].dt.floor("D") == D]
        if len(trd) < 500 or trd["y"].sum() < 25:
            return D, ted.index.values, np.full(len(ted), np.nan), len(trd)
        p, _, _ = run_variant(trd, ted, "note_tfidf")
        return D, ted.index.values, p, len(trd)

    t0 = time.time()
    res = Parallel(n_jobs=NJOBS)(delayed(one_day)(D) for D in days)
    ours["corpus_wf"] = np.nan
    daylog = []
    for D, idx, p, ntr in res:
        ours.loc[idx, "corpus_wf"] = p
        daylog.append(dict(day=str(pd.Timestamp(D).date()), n_notes=len(idx), n_corpus_train=ntr))
    print(f"  walk-forward: {len(days)} daily refits in {time.time() - t0:.0f}s")
    w(f"- **Walk-forward version:** the corpus model is refitted for every UTC submit day D on the "
      f"corpus notes **created before D minus 7 days**, so nothing the model sees was written or "
      f"rated after our note went out. The corpus is old relative to our window — the training "
      f"pool only moves from {daylog[0]['n_corpus_train']} to {daylog[-1]['n_corpus_train']} notes "
      f"across the {len(days)} days — so this changes little, but it makes the score legal as a "
      f"forecast. {len(days)} refits.")
    w()

    # ---- align to the prior backtest's scored notes
    pred = pd.read_parquet(BASELINES / "predictions.parquet")
    scored = pred[(pred["scored"]) & (pred["target"] == "H")]
    base = scored[scored["forecaster"] == "prior_30d"][["note_id", "submitted_at", "refit_day", "y", "p"]]
    base = base.rename(columns={"p": "prior_30d"})
    j = base.merge(ours[["note_id", "note_text", "corpus_static", "corpus_wf", "H"]],
                   on="note_id", how="left")
    assert len(j) == len(base) == 977, (len(j), len(base))
    n_flip = int((j["y"].values != j["H"].values).sum())
    # The prior backtest's y is the label of record, so the comparison is exact.
    miss = j["note_text"].isna() | (j["note_text"].fillna("").str.len() == 0)
    med_s, med_w = ours["corpus_static"].median(), ours["corpus_wf"].median()
    j.loc[miss, "corpus_static"] = med_s
    j.loc[miss, "corpus_wf"] = med_w
    w(f"- **Label drift.** Re-pulling `notes` 9 h after the prior backtest's pull moved "
      f"{n_flip} of the 977 labels (a note left CURRENTLY_RATED_HELPFUL). Statuses are not "
      f"permanent. The prior backtest's `y` is used throughout so the comparison is exact.")
    w(f"- **Scored on the identical 977 notes** of the prior backtest (90 H, 27 NH, submitted "
      f"{base['submitted_at'].min():%Y-%m-%d} to {base['submitted_at'].max():%Y-%m-%d}); labels "
      f"taken from that file. {int(miss.sum())} of the 977 has no `pipeline_runs.note_text` "
      f"and is given the median corpus score, so that every forecaster is scored on the same 977. "
      f"Metrics excluding it are given below and are unchanged to 4 decimals.")
    w()

    # ---- score distribution: how far out of distribution are our notes?
    w("### 3a. Where our notes land on the corpus model's scale")
    w()
    w("| population | n | mean corpus score | 10th | 50th | 90th | true helpful rate |")
    w("|---|---|---|---|---|---|---|")
    for lab, s, rate in [("our 977 scored notes", j["corpus_static"].values, j["y"].mean()),
                         ("our matured window notes", ours["corpus_static"].dropna().values, ours["H"].mean())]:
        q = np.percentile(s, [10, 50, 90])
        w(f"| {lab} | {len(s)} | {s.mean():.3f} | {q[0]:.3f} | {q[1]:.3f} | {q[2]:.3f} | {pct(rate)} |")
    w(f"| corpus pool (training rows, true rate) | {len(pool)} | - | - | - | - | {pct(pool['y'].mean())} |")
    w()

    # ---- metrics
    y = j["y"].values
    rows = []

    def add(name, p, note=""):
        d, lo, hi = boot_diff(y, p, j["prior_30d"].values)
        rows.append((name, brier(y, p), logloss(y, p), auc(y, p), d, lo, hi,
                     "yes, better" if hi < 0 else ("yes, worse" if lo > 0 else "no"), note))

    add("prior_30d (reference)", j["prior_30d"].values)
    add("corpus_raw (static fit)", j["corpus_static"].values, "raw P(H|text) from the corpus; no calibration to our base rate")
    add("corpus_raw_wf (walk-forward)", j["corpus_wf"].values, "same, legal timing")

    # walk-forward Platt, same recipe as the prior backtest
    allnotes = ours.dropna(subset=["corpus_wf"]).sort_values("when")
    for col, outname in [("corpus_wf", "corpus_wf_platt")]:
        p_out = pd.Series(np.nan, index=j.index)
        active = 0
        for D, gd in j.groupby("refit_day"):
            past = allnotes[allnotes["when"] < D - LAG]
            if len(past) >= SETTINGS["platt"]["min_n"] and past["H"].sum() >= SETTINGS["platt"]["min_pos"]:
                pl = LogisticRegression(C=SETTINGS["platt"]["C"], max_iter=1000).fit(
                    logit(past[col].values).reshape(-1, 1), past["H"].values)
                p_out.loc[gd.index] = pl.predict_proba(logit(gd[col].values).reshape(-1, 1))[:, 1]
                active += len(gd)
            else:
                p_out.loc[gd.index] = j.loc[gd.index, "prior_30d"]
        add(outname, p_out.values, f"Platt on our own earlier notes, refit daily under the same 7-day label lag; active on {active} of 977")
        j[outname] = p_out.values

    w("### 3b. Scored against `prior_30d` on the identical 977 notes")
    w()
    w("Brier difference is forecaster minus `prior_30d`; negative is better. "
      f"{SETTINGS['bootstrap_draws']}-draw note-level bootstrap, percentile interval, same "
      "resamples for every row.")
    w()
    w("| forecaster | Brier | log loss | AUC | Brier diff vs prior_30d [95%] | excludes 0? |")
    w("|---|---|---|---|---|---|")
    for name, b, ll, a, d, lo, hi, excl, note in rows:
        dd = "ref" if name.startswith("prior_30d") else f"{d:+.5f} [{lo:+.5f}, {hi:+.5f}]"
        ee = "-" if name.startswith("prior_30d") else excl
        w(f"| `{name}` | {b:.5f} | {ll:.4f} | {a:.3f} | {dd} | {ee} |")
    w()
    for name, *_, note in rows:
        if note:
            w(f"- `{name}` — {note}")
    w()
    # AUC for the other two targets
    nh = pred[(pred["scored"]) & (pred["target"] == "NH") & (pred["forecaster"] == "prior_30d")][["note_id", "y"]]
    ra = pred[(pred["scored"]) & (pred["target"] == "rated") & (pred["forecaster"] == "prior_30d")][["note_id", "y"]]
    j2 = j.merge(nh.rename(columns={"y": "y_nh"}), on="note_id").merge(ra.rename(columns={"y": "y_rated"}), on="note_id")
    w(f"- Same corpus score against the other two targets on the same 977: AUC for NOT-helpful "
      f"{auc(j2['y_nh'].values, j2['corpus_static'].values):.3f} (27 positives), AUC for "
      f"rated-at-all {auc(j2['y_rated'].values, j2['corpus_static'].values):.3f} (117 positives).")
    excl_j = j[~miss.values]
    w(f"- Dropping the one text-less note: Brier "
      f"{brier(excl_j['y'].values, excl_j['corpus_wf_platt'].values):.5f}, AUC "
      f"{auc(excl_j['y'].values, excl_j['corpus_static'].values):.3f} (n={len(excl_j)}).")
    w()

    # ---- the brief's explicit temporal recalibration
    w("### 3c. Recalibrated on our own notes with a strictly temporal split")
    w()
    fit = ours[(ours["when"] < RECAL_SPLIT) & ours["corpus_static"].notna()]
    tset = j[j["submitted_at"] >= RECAL_SPLIT]
    pl = LogisticRegression(C=SETTINGS["platt"]["C"], max_iter=1000).fit(
        logit(fit["corpus_static"].values).reshape(-1, 1), fit["H"].values)
    p_rc = pl.predict_proba(logit(tset["corpus_static"].values).reshape(-1, 1))[:, 1]
    yt = tset["y"].values
    d, lo, hi = boot_diff(yt, p_rc, tset["prior_30d"].values)
    w(f"- Recalibrator fitted on **{len(fit)}** of our matured window notes submitted before "
      f"{RECAL_SPLIT:%Y-%m-%d} ({int(fit['H'].sum())} helpful, {pct(fit['H'].mean())}); tested on "
      f"the **{len(tset)}** of the 977 submitted on or after it "
      f"({int(yt.sum())} helpful, {pct(yt.mean())}). Notes submitted 2026-08-23 to 2026-08-31 "
      f"({int((j['submitted_at'] < RECAL_SPLIT).sum())} of the 977) drop out of the test set.")
    w()
    w("| forecaster | n | Brier | log loss | AUC | Brier diff vs prior_30d [95%] | excludes 0? |")
    w("|---|---|---|---|---|---|---|")
    w(f"| `prior_30d` | {len(tset)} | {brier(yt, tset['prior_30d'].values):.5f} | "
      f"{logloss(yt, tset['prior_30d'].values):.4f} | {auc(yt, tset['prior_30d'].values):.3f} | ref | - |")
    w(f"| `corpus_raw` | {len(tset)} | {brier(yt, tset['corpus_static'].values):.5f} | "
      f"{logloss(yt, tset['corpus_static'].values):.4f} | {auc(yt, tset['corpus_static'].values):.3f} | "
      f"{boot_diff(yt, tset['corpus_static'].values, tset['prior_30d'].values)[0]:+.5f} "
      f"[{boot_diff(yt, tset['corpus_static'].values, tset['prior_30d'].values)[1]:+.5f}, "
      f"{boot_diff(yt, tset['corpus_static'].values, tset['prior_30d'].values)[2]:+.5f}] | "
      f"{'yes, better' if boot_diff(yt, tset['corpus_static'].values, tset['prior_30d'].values)[2] < 0 else ('yes, worse' if boot_diff(yt, tset['corpus_static'].values, tset['prior_30d'].values)[1] > 0 else 'no')} |")
    w(f"| `corpus_recal_2026-09-01` | {len(tset)} | {brier(yt, p_rc):.5f} | {logloss(yt, p_rc):.4f} | "
      f"{auc(yt, p_rc):.3f} | {d:+.5f} [{lo:+.5f}, {hi:+.5f}] | "
      f"{'yes, better' if hi < 0 else ('yes, worse' if lo > 0 else 'no')} |")
    w()
    w(f"- Fitted recalibration: logit(p_recal) = {pl.intercept_[0]:.3f} + "
      f"{pl.coef_[0][0]:.3f} x logit(corpus score). A slope near 0 means the corpus score carries "
      f"almost no information about our notes; a slope near 1 would mean the corpus model's "
      f"log-odds transfer one-for-one.")
    w()
    return ours, j, pool, m_static, d_static, daylog


# =====================================================================================
# 4. Does it add to stable4?
# =====================================================================================
def incremental(ours, j):
    w("## 4. Does the corpus score add anything to `stable4`?")
    w()
    SCREEN = HERE.parent / "2026_09_18_outcome_screen"
    FB = HERE.parent / "2026_09_18_forecast_baselines"
    sys.path.insert(0, str(SCREEN))
    sys.path.insert(0, str(FB))
    import screen as scr  # noqa
    import forecast as fc  # noqa
    meta, pulled_at, cutoff, t = scr.load()
    _, _, df = scr.build(t, cutoff)
    X = fc.features(df)
    cols = fc.FEATS["stable4"]
    df = df.reset_index(drop=True)
    X = X.reset_index(drop=True)
    X["note_id"] = df["note_id"]
    X["when"] = df["when"]          # keep tz-awareness; .values would strip it
    X["H"] = df["H"]
    X = X.merge(ours[["note_id", "corpus_wf", "corpus_static"]], on="note_id", how="left")
    aug = X[(X["when"] >= WINDOW_START) & (X["when"] < pd.Timestamp("2026-09-01", tz="UTC"))]
    sep = X[(X["when"] >= pd.Timestamp("2026-09-01", tz="UTC"))]
    w(f"- Fit on our matured August notes (**{len(aug)}**, {int(aug['H'].sum())} helpful), tested on "
      f"our matured September notes (**{len(sep)}**, {int(sep['H'].sum())} helpful). "
      f"`stable4` = {cols}. The corpus score enters as its logit. Missing features are imputed "
      f"with the August median and continuous features scaled with August mean/sd, as in the prior "
      f"backtest.")
    w()
    out = []
    for name, use in [("stable4", cols), ("stable4 + corpus_wf", cols + ["corpus_logit"]),
                      ("corpus_wf alone", ["corpus_logit"])]:
        A, S = aug.copy(), sep.copy()
        A["corpus_logit"], S["corpus_logit"] = logit(A["corpus_wf"]), logit(S["corpus_wf"])
        Xa, Xs = A[use].copy(), S[use].copy()
        med = Xa.median().fillna(0.0)
        Xa, Xs = Xa.fillna(med), Xs.fillna(med)
        for c in use:
            mu, sd = Xa[c].mean(), Xa[c].std()
            sd = sd if sd > 0 else 1.0
            Xa[c], Xs[c] = (Xa[c] - mu) / sd, (Xs[c] - mu) / sd
        m = LogisticRegression(C=1.0, max_iter=2000).fit(Xa.values, A["H"].values)
        p = m.predict_proba(Xs.values)[:, 1]
        coef = dict(zip(use, np.round(m.coef_[0], 3)))
        out.append((name, brier(S["H"].values, p), logloss(S["H"].values, p),
                    auc(S["H"].values, p), coef.get("corpus_logit"), p))
    w("| model | Brier (Sep) | log loss | AUC | coef on corpus logit |")
    w("|---|---|---|---|---|")
    for name, b, ll, a, c, _ in out:
        w(f"| `{name}` | {b:.5f} | {ll:.4f} | {a:.3f} | {'-' if c is None else f'{c:+.3f}'} |")
    w()
    d, lo, hi = boot_diff(sep["H"].values, out[1][5], out[0][5])
    w(f"- Brier difference, `stable4 + corpus_wf` minus `stable4`, on the {len(sep)} September "
      f"notes: **{d:+.5f} [{lo:+.5f}, {hi:+.5f}]** — "
      f"{'excludes zero on the better side' if hi < 0 else ('excludes zero on the worse side' if lo > 0 else 'includes zero')}. "
      f"AUC {out[0][3]:.3f} to {out[1][3]:.3f}.")
    w()
    return X


# =====================================================================================
# 5. Sanity checks against learning the selection
# =====================================================================================
def sanity(store, cen, pool, m_static, d_static, ours, X):
    w("## 5. Sanity checks: quality, or the selection?")
    w()
    key = "note_tfidf/H_vs_NMR/census"
    d, oof = store[key]["d"], store[key]["oof"]

    # (a) age
    w("### 5a. Does the score just track note age?")
    w()
    now = pd.Timestamp(json.loads((DATA / "pull_meta.json").read_text())["pulled_at_utc"])
    a = d.copy()
    a["score"] = oof
    a["age_d"] = (now - a["created"]).dt.total_seconds() / 86400
    rho = a[["score", "age_d"]].corr(method="spearman").iloc[0, 1]
    rho_y = a[["y", "age_d"]].corr(method="spearman").iloc[0, 1]
    w(f"- Spearman(out-of-fold score, note age in days) = **{rho:+.3f}**. "
      f"Spearman(true label, note age) = {rho_y:+.3f}.")
    bins = [0, 14, 30, 60, 120, 240, 1e6]
    labs = ["0-14d", "14-30d", "30-60d", "60-120d", "120-240d", "240d+"]
    a["ab"] = pd.cut(a["age_d"], bins, labels=labs)
    w()
    w("| note age | n | mean out-of-fold score | true H rate |")
    w("|---|---|---|---|")
    for lab, g in a.groupby("ab", observed=True):
        w(f"| {lab} | {len(g)} | {g['score'].mean():.3f} | {pct(g['y'].mean())} |")
    w()

    # (b) within-tweet
    w("### 5b. Within-tweet comparison (tweet-level selection removed)")
    w()
    g = a.groupby("tweet_id")
    mixed = g.filter(lambda x: x["y"].nunique() == 2)
    conc = tied = disc = 0
    for tid, gg in mixed.groupby("tweet_id"):
        hs, ns = gg[gg["y"] == 1]["score"].values, gg[gg["y"] == 0]["score"].values
        conc += int((hs[:, None] > ns[None, :]).sum())
        tied += int((hs[:, None] == ns[None, :]).sum())
        disc += int((hs[:, None] < ns[None, :]).sum())
    tot = max(conc + tied + disc, 1)
    w(f"- Corpus tweets carrying both a helpful and a non-helpful note: **{mixed['tweet_id'].nunique()}**, "
      f"giving **{tot}** within-tweet (helpful, not-helpful) pairs. The model puts the helpful one "
      f"higher in **{conc}** of them: within-tweet AUC **{(conc + 0.5 * tied) / tot:.3f}**. "
      f"This uses out-of-fold scores only, and comparing two notes on the *same* tweet removes "
      f"every tweet-level selection effect (topic, virality, whether our pipeline picked it, "
      f"whether X's dump lists it).")
    w()
    # ours vs best competitor
    comp_all = pd.read_parquet(DATA / "competing_notes.parquet")
    comp_all = comp_all[comp_all["our_note_id"].notna()]
    comp_all["created"] = pd.to_datetime(comp_all["created_at_millis"], unit="ms", utc=True)
    cmp_w = comp_all[comp_all["tweet_id"].isin(set(ours["tweet_id"]))].copy()
    if len(cmp_w):
        p_c, _, _ = run_variant(pool, cmp_w.assign(note_text=cmp_w["note_text"]), "note_tfidf")
        cmp_w["score"] = p_c
        best = cmp_w.groupby("tweet_id")["score"].max()
        o = ours.copy()
        o["best_comp"] = o["tweet_id"].map(best)
        o2 = o.dropna(subset=["best_comp", "corpus_static"])
        o2 = o2[o2["note_id"].isin(set(X["note_id"]))]
        o2["margin"] = logit(o2["corpus_static"]) - logit(o2["best_comp"])
        w(f"- Same comparison on **our** notes: {len(o2)} of our matured window notes sit on a tweet "
          f"that also carries someone else's note. The model scores ours above the best competitor "
          f"on that tweet {pct((o2['margin'] > 0).mean())} of the time. Our note's *margin* over the "
          f"best competitor ranks our own helpful outcome with AUC "
          f"**{auc(o2['H'].values, o2['margin'].values):.3f}** "
          f"(vs {auc(o2['H'].values, o2['corpus_static'].values):.3f} for the raw score on the same "
          f"{len(o2)} notes, {int(o2['H'].sum())} helpful).")
        w()

    # (c) weights
    w("### 5c. What the model actually learned (top 25 each way)")
    w()
    w("Weights of the **transfer model** — the primary variant fitted on the corpus pool that "
      "excludes our window tweets, i.e. the exact model scored in section 3. Word n-grams are "
      "`w:`, character n-grams `c:`, structural `s:`, domain flags `d:`. Features are TF-IDF "
      "scaled, so the coefficients are comparable within a block but not across blocks.")
    w()
    names, coef = d_static.names, m_static.coef_[0]
    order = np.argsort(coef)
    top_pos = order[::-1][:25]
    top_neg = order[:25]
    w("| # | pushes toward HELPFUL | weight | pushes toward NEEDS_MORE_RATINGS | weight |")
    w("|---|---|---|---|---|")
    for i in range(25):
        w(f"| {i + 1} | `{names[top_pos[i]]}` | {coef[top_pos[i]]:+.3f} | "
          f"`{names[top_neg[i]]}` | {coef[top_neg[i]]:+.3f} |")
    w()
    st = [(n, c) for n, c in zip(names, coef) if n.startswith("s:") or n.startswith("d:")]
    st.sort(key=lambda x: -abs(x[1]))
    w("Structural and domain features only, by absolute weight:")
    w()
    w("| feature | weight |")
    w("|---|---|")
    for n, c in st[:20]:
        w(f"| `{n}` | {c:+.3f} |")
    w()
    return a


# =====================================================================================
# 6. The trap
# =====================================================================================
def trap(store):
    w("## 6. The trap: what happens if you keep the missed-opportunity rows")
    w()
    k = "note_tfidf/H_vs_NMR/trap"
    if k not in store:
        return
    des = store[k]["design"]
    m = store[k]["model"]
    names, coef = des.names, m.coef_[0]
    order = np.argsort(coef)
    w("Same features, same hyperparameters, but the 12,692 stage-G rows are added as positives. "
      "The tweet-split AUC in section 2 jumps, and the weights show why: the model is separating "
      "*tweets our pipeline rejected* from *tweets our pipeline noted*, which is a fact about our "
      "own filter, not about note quality. It would be the obvious thing to build and it would be "
      "worthless.")
    w()
    w("| # | pushes toward 'helpful' | weight | pushes away | weight |")
    w("|---|---|---|---|---|")
    for i in range(12):
        w(f"| {i + 1} | `{names[order[::-1][i]]}` | {coef[order[::-1][i]]:+.3f} | "
          f"`{names[order[i]]}` | {coef[order[i]]:+.3f} |")
    w()


# =====================================================================================
def main():
    t0 = time.time()
    comp, tweets, notes, ours = load()
    meta = json.loads((DATA / "pull_meta.json").read_text())
    cutoff = pd.Timestamp(meta["pulled_at_utc"]) - LAG
    ours = ours[ours["when"] < cutoff].copy().reset_index(drop=True)
    print(f"  matured window notes: {len(ours)}  H {int(ours['H'].sum())}  NH {int(ours['NH'].sum())}")

    cen = characterise(comp, ours, tweets)
    store = in_corpus(cen, comp)
    ours, j, pool, m_static, d_static, daylog = transfer(cen, ours)
    X = incremental(ours, j)
    a = sanity(store, cen, pool, m_static, d_static, ours, X)
    trap(store)

    w("## 7. Settings, fixed before any transfer result was seen")
    w()
    w("```json")
    w(json.dumps(SETTINGS, indent=2, default=str))
    w("```")
    w()
    w("| where a leak could have entered | what stops it |")
    w("|---|---|")
    for a_, b_ in [
        ("Several notes share a tweet; a random split puts near-duplicates on both sides",
         "GroupKFold on a union-find group over tweet_id and an md5 of the note text"),
        ("Vectorizer vocabulary / IDF / scaler / top-domain list fitted on all rows",
         "every transform is fitted inside the fold, on training rows only"),
        ("The corpus contains notes on the very tweets we are scoring",
         "the transfer pool drops all 2,190 of our window tweets before fitting (3,244 census rows removed)"),
        ("Our own notes appearing in the corpus", "checked: 0 of our 8,830 note ids occur in competing_notes"),
        ("Corpus notes written or rated after our note was submitted",
         "the walk-forward model only sees corpus notes created before D minus 7 days"),
        ("Recalibrating on the notes we then score",
         "Platt fitted only on our notes submitted before D minus 7 days (walk-forward) or before 2026-09-01 (section 3c)"),
        ("Tuning hyperparameters against our notes' outcomes",
         "all settings above fixed before the first transfer run; all seven model configurations reported"),
        ("Comparing on a different note set than the prior baselines",
         "the 977 note ids and their labels are taken from predictions.parquet and asserted equal"),
    ]:
        w(f"| {a_} | {b_} |")
    w()

    ours.to_parquet(DATA / "our_notes_scored.parquet")
    j.to_parquet(DATA / "transfer_scores_977.parquet")
    a[["note_id", "tweet_id", "y", "score", "age_d"]].to_parquet(DATA / "corpus_oof_scores.parquet")
    (DATA / "run_meta.json").write_text(json.dumps(
        dict(settings=SETTINGS, walk_forward_days=daylog, elapsed_s=round(time.time() - t0)),
        indent=2, default=str))

    # Part A of RESULTS.md. results.py stitches the parts together.
    (DATA / "part_a.md").write_text(
        "# PART A — Learning from other authors' notes (the transfer test)\n\n"
        + "\n".join(OUT) + "\n")
    print(f"  done in {time.time() - t0:.0f}s -> data/part_a.md")


if __name__ == "__main__":
    main()
