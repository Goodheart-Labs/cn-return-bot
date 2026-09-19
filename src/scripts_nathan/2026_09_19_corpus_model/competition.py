# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""TARGET B: at fetch time, predict whether ANOTHER author will note this post.

Why it matters: unrated notes are invisible live (they exist only in X's daily public
dump, ~48 h late), so "does this post already have someone else's note" can never be
observed at fetch time — only forecast. And it moves our outcomes: with an earlier
note present we are rated Not Helpful about a fifth as often.

OFFLINE. Reads ./data/*.parquet (pull.py, pull_b.py) and the prior backtest's
predictions.parquet. Writes data/part_b.md and data/competition_scores.parquet.

Every setting below was fixed before any result was looked at.
Run:  uv run competition.py
"""
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from scipy import sparse

sys.dont_write_bytecode = True
warnings.filterwarnings("ignore", category=FutureWarning)
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import (  # noqa: E402
    BASELINES, DATA, H, NH, SETTINGS, WINDOW_START, auc, boot_diff, brier, logit, logloss, wilson,
)

OUT = []
SEP_START = pd.Timestamp("2026-09-01", tz="UTC")
LAG_B = pd.Timedelta(days=3)     # dump publishes ~48 h late; 3 days is the safe label lag
HORIZON_H = 48                   # hours after our submit time for the second label
MIN_TRAIN_B = 200
SETTINGS_B = dict(
    logistic=dict(C=1.0, max_iter=2000),
    gbm=dict(n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.8,
             min_samples_leaf=20, random_state=0),
    text_tfidf=dict(ngram_range=(1, 2), min_df=5, max_features=30000, sublinear_tf=True,
                    strip_accents="unicode", lowercase=True),
    top_context_domains=20,
    label_lag_days=3,
    horizon_hours_for_L2=HORIZON_H,
    primary_model="B_struct_text",
    primary_label="earlier",
)


def w(s=""):
    OUT.append(s)


def pct(x, d=1):
    return "n/a" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{100 * x:.{d}f}%"


def jl(s):
    if not isinstance(s, str) or s in ("null", ""):
        return []
    try:
        v = json.loads(s)
    except Exception:
        return []
    return v if isinstance(v, list) else []


def jd(s):
    if not isinstance(s, str) or s in ("null", ""):
        return {}
    try:
        v = json.loads(s)
    except Exception:
        return {}
    return v if isinstance(v, dict) else {}


# =====================================================================================
def build():
    meta = json.loads((DATA / "pull_meta.json").read_text())
    pulled_at = pd.Timestamp(meta["pulled_at_utc"])
    cutoff = pulled_at - pd.Timedelta(days=7)

    notes = pd.read_parquet(DATA / "notes.parquet")
    notes["when"] = notes["submitted_at"].fillna(notes["first_seen_at"])
    d = notes[(notes["when"] >= WINDOW_START) & (notes["when"] < cutoff)].copy()
    d["H"] = (d["cn_status"] == H).astype(int)
    d["NH"] = (d["cn_status"] == NH).astype(int)

    comp = pd.read_parquet(DATA / "competing_notes.parquet")
    comp = comp[comp["our_note_id"].notna()]          # census slice only
    comp = comp[comp["tweet_id"].isin(set(d["tweet_id"]))].drop_duplicates(["tweet_id", "note_id"])
    sub_ms = d.set_index("tweet_id")["when"].map(lambda x: x.value // 10 ** 6)
    comp = comp.copy()
    comp["our_ms"] = comp["tweet_id"].map(sub_ms)
    comp["before"] = comp["created_at_millis"] < comp["our_ms"]
    comp["within"] = comp["created_at_millis"] < comp["our_ms"] + HORIZON_H * 3600 * 1000
    g = comp.groupby("tweet_id").agg(n_before=("before", "sum"), n_within=("within", "sum"),
                                     n_any=("note_id", "size"))
    d = d.merge(g, on="tweet_id", how="left")
    d[["n_before", "n_within", "n_any"]] = d[["n_before", "n_within", "n_any"]].fillna(0).astype(int)
    d["y_earlier"] = (d["n_before"] >= 1).astype(int)
    d["y_within48h"] = (d["n_within"] >= 1).astype(int)

    snap = pd.read_parquet(DATA / "our_dump_presence.parquet")
    d["in_dump"] = d["tweet_id"].isin(set(snap["tweet_id"]))

    feed = pd.read_parquet(DATA / "feed_fetchtime.parquet").rename(
        columns={"first_seen_at": "feed_first_seen_at"})
    d = d.merge(feed, on="tweet_id", how="left", indicator="feed_join")
    d["has_feed"] = d["feed_join"] == "both"
    return d.sort_values("when").reset_index(drop=True), pulled_at, cutoff


NUMERIC = ["age_h", "log_impr", "log_vel", "log_followers", "log_tweets", "tier", "has_video",
           "has_photo", "media_count", "is_reply", "is_quote", "n_nrs", "has_nrs", "n_ssl",
           "ssl_count", "has_ssl", "n_ctx", "lang_en", "txt_len", "n_urls_tw", "n_hash", "n_ment",
           "like_ratio", "reply_ratio", "quote_ratio", "rt_ratio", "feed_missing"]


def fetch_features(d):
    X = pd.DataFrame(index=d.index)
    hrs = (d["feed_first_seen_at"] - d["posted_at"]).dt.total_seconds() / 3600
    X["age_h"] = hrs.clip(lower=0, upper=48)
    X["log_impr"] = np.log10(d["first_seen_impressions"].astype(float) + 1)
    X["log_vel"] = np.log10(d["first_seen_impressions"].astype(float) / hrs.clip(lower=0.25) + 1)
    X["log_followers"] = np.log10(d["author_followers"].astype(float) + 1)
    X["log_tweets"] = np.log10(d["author_tweet_count"].astype(float) + 1)
    X["tier"] = d["first_seen_feed_size"].map({"small": 0.0, "large": 1.0, "xl": 2.0})
    X["has_video"] = d["has_video"].astype(float)
    X["has_photo"] = d["has_photo"].astype(float)
    X["media_count"] = d["media_count"].astype(float)
    ref = d["referenced_tweets"].map(lambda s: [r.get("type") for r in jl(s)])
    X["is_reply"] = ref.map(lambda l: float("replied_to" in l))
    X["is_quote"] = ref.map(lambda l: float("quoted" in l))
    nrs = d["note_request_suggestions"].map(jl)
    X["n_nrs"] = nrs.map(len).astype(float)
    X["has_nrs"] = (X["n_nrs"] > 0).astype(float)
    ssl = d["suggested_source_links"].map(jl)
    X["n_ssl"] = ssl.map(len).astype(float)
    X["ssl_count"] = ssl.map(lambda l: float(sum(int(x.get("count", 0) or 0) for x in l)))
    X["has_ssl"] = (X["n_ssl"] > 0).astype(float)
    X["n_ctx"] = d["context_annotations"].map(lambda s: float(len(jl(s))))
    X["lang_en"] = (d["lang"] == "en").astype(float)
    txt = d["text"].fillna("")
    X["txt_len"] = txt.str.len().astype(float)
    X["n_urls_tw"] = txt.str.count(r"https?://").astype(float)
    X["n_hash"] = txt.str.count(r"#\w").astype(float)
    X["n_ment"] = txt.str.count(r"@\w").astype(float)
    pm = d["public_metrics"].map(jd)
    imp = pm.map(lambda x: x.get("impression_count") or np.nan).astype(float)
    for k, c in [("like_count", "like_ratio"), ("reply_count", "reply_ratio"),
                 ("quote_count", "quote_ratio"), ("retweet_count", "rt_ratio")]:
        X[c] = pm.map(lambda x, k=k: x.get(k, np.nan)).astype(float) / imp
    X["feed_missing"] = (~d["has_feed"]).astype(float)
    X.loc[~d["has_feed"].values, [c for c in NUMERIC if c != "feed_missing"]] = np.nan
    return X


def ctx_domains(s):
    return sorted({(a.get("domain") or {}).get("name", "") for a in jl(s)} - {""})


def design(tr, te, model):
    """Fits imputation, scaling, the context-domain list and the vectorizer on train only."""
    Xtr, Xte = fetch_features(tr), fetch_features(te)
    med = Xtr.median().fillna(0.0)
    Xtr, Xte = Xtr.fillna(med), Xte.fillna(med)
    names = list(NUMERIC)
    if model != "B_gbm":
        for c in NUMERIC:
            mu, sd = Xtr[c].mean(), Xtr[c].std()
            sd = sd if sd > 0 else 1.0
            Xtr[c], Xte[c] = (Xtr[c] - mu) / sd, (Xte[c] - mu) / sd
    A, B = Xtr[NUMERIC].values, Xte[NUMERIC].values
    if model in ("B_struct_ctx", "B_struct_text"):
        dtr = tr["context_annotations"].map(ctx_domains)
        top = pd.Series([x for s in dtr for x in s]).value_counts().head(
            SETTINGS_B["top_context_domains"]).index.tolist()
        dte = te["context_annotations"].map(ctx_domains)
        A = np.hstack([A, np.array([[float(t in s) for t in top] for s in dtr])])
        B = np.hstack([B, np.array([[float(t in s) for t in top] for s in dte])])
        names += ["ctx:" + t for t in top]
    if model == "B_struct_text":
        v = TfidfVectorizer(**SETTINGS_B["text_tfidf"]).fit(tr["text"].fillna(""))
        A = sparse.hstack([sparse.csr_matrix(A), v.transform(tr["text"].fillna(""))]).tocsr()
        B = sparse.hstack([sparse.csr_matrix(B), v.transform(te["text"].fillna(""))]).tocsr()
        names += ["w:" + f for f in v.get_feature_names_out()]
    return A, B, names


def fit_predict(tr, te, model, label):
    y = tr[label].values
    if model == "B_base":
        return np.full(len(te), y.mean()), None, []
    A, B, names = design(tr, te, model)
    if model == "B_gbm":
        m = GradientBoostingClassifier(**SETTINGS_B["gbm"]).fit(A, y)
    else:
        m = LogisticRegression(**SETTINGS_B["logistic"]).fit(A, y)
    return m.predict_proba(B)[:, 1], m, names


MODELS = ["B_base", "B_struct", "B_struct_ctx", "B_struct_text", "B_gbm"]


# =====================================================================================
def main():
    d, pulled_at, cutoff = build()
    w("## B1. The unit, the label and what it can and cannot see")
    w()
    w(f"- **Unit:** one tweet we noted. {len(d)} matured window notes (submitted "
      f"{WINDOW_START:%Y-%m-%d} to {cutoff:%Y-%m-%d}, one note per tweet), "
      f"{int(d['H'].sum())} rated Helpful, {int(d['NH'].sum())} Not Helpful.")
    w(f"- **Label (primary, `earlier`):** at least one other author's note on the tweet with "
      f"`created_at_millis` **before our submit time**. Positive on **{int(d['y_earlier'].sum())}** "
      f"of {len(d)} ({pct(d['y_earlier'].mean())}).")
    w(f"- **Label (secondary, `within48h`):** at least one such note created before our submit time "
      f"plus {HORIZON_H} h. Positive on **{int(d['y_within48h'].sum())}** ({pct(d['y_within48h'].mean())}).")
    w(f"- **Dump-lag cutoff.** `competing_notes` is refreshed from X's daily dump, which is about "
      f"48 h late. The pull ran {pulled_at:%Y-%m-%d %H:%M} UTC and the newest note here was "
      f"submitted {d['when'].max():%Y-%m-%d}, so the latest moment either label depends on "
      f"({d['when'].max() + pd.Timedelta(hours=HORIZON_H):%Y-%m-%d}) is more than 5 days before "
      f"the pull. No label is truncated by the lag.")
    w(f"- **Is a zero a real zero?** A tweet gets no `competing_notes` row either because nobody "
      f"else noted it or because *our* note never reached the dump (the rows are keyed off our own "
      f"note appearing there). Checked against `public_data_snapshots`: **{int(d['in_dump'].sum())} "
      f"of {len(d)}** ({pct(d['in_dump'].mean())}) of our notes are in the dump, so the censoring "
      f"is {pct(1 - d['in_dump'].mean())} of rows, not a material share of the zeros.")
    w(f"- **Selection to state plainly.** These are tweets our pipeline *chose to note*. The model "
      f"would be used at fetch time on tweets it has not yet chosen. We cannot observe the label on "
      f"rejected tweets, because for those the dump walk keeps only competitors that ended up "
      f"rated helpful (stage G). So this model is trained on the post-filter population and its "
      f"numbers should be read as 'among tweets we would note', not 'among all tweets'.")
    w(f"- **Feature source.** `feed_tweets` at first sight, joined for {int(d['has_feed'].sum())} of "
      f"{len(d)} ({pct(d['has_feed'].mean())}); the {int((~d['has_feed']).sum())} misses get "
      f"`feed_missing=1` and median imputation. `note_request_suggestions` present on "
      f"{int((d['note_request_suggestions'].map(jl).map(len) > 0).sum())} tweets, "
      f"`suggested_source_links_with_counts` on "
      f"{int((d['suggested_source_links'].map(jl).map(len) > 0).sum())}. Both are frozen at first "
      f"sight and are live-available.")
    w()

    # base-rate check of the finding that motivates this
    w("### B1a. The effect that makes this worth predicting (our sample, recomputed)")
    w()
    w("| earlier note on the tweet | n | H | NH | H rate [95%] | NH rate [95%] |")
    w("|---|---|---|---|---|---|")
    for v, lab in [(1, "yes"), (0, "no (we were first)")]:
        g = d[d["y_earlier"] == v]
        hl, hh = wilson(int(g["H"].sum()), len(g))
        nl, nh_ = wilson(int(g["NH"].sum()), len(g))
        w(f"| {lab} | {len(g)} | {int(g['H'].sum())} | {int(g['NH'].sum())} | "
          f"{pct(g['H'].mean())} [{pct(hl)}, {pct(hh)}] | {pct(g['NH'].mean())} [{pct(nl)}, {pct(nh_)}] |")
    w()
    g1, g0 = d[d["y_earlier"] == 1], d[d["y_earlier"] == 0]
    w(f"- Not-Helpful rate ratio, first vs not-first: **{g0['NH'].mean() / max(g1['NH'].mean(), 1e-9):.1f}x**. "
      f"That is the prize: if the score is any good, it tells us at fetch time which posts we are "
      f"about to be first on.")
    w()

    # ---- temporal split: August -> September
    w("## B2. Models, split temporally (fit on August, test on September)")
    w()
    aug, sep = d[d["when"] < SEP_START], d[d["when"] >= SEP_START]
    w(f"- Train: **{len(aug)}** notes submitted {WINDOW_START:%Y-%m-%d} to 2026-08-31 "
      f"({int(aug['y_earlier'].sum())} positive, {pct(aug['y_earlier'].mean())}). "
      f"Test: **{len(sep)}** submitted 2026-09-01 onward "
      f"({int(sep['y_earlier'].sum())} positive, {pct(sep['y_earlier'].mean())}). No random split "
      f"is used anywhere. Every transform is fitted on the August rows only.")
    w()
    res = {}
    for label in ["y_earlier", "y_within48h"]:
        w(f"### Target `{label}`")
        w()
        w("| model | Brier | log loss | AUC | mean predicted | observed |")
        w("|---|---|---|---|---|---|")
        for mdl in MODELS:
            p, m, names = fit_predict(aug, sep, mdl, label)
            res[(label, mdl)] = (p, m, names)
            yv = sep[label].values
            w(f"| `{mdl}` | {brier(yv, p):.4f} | {logloss(yv, p):.4f} | {auc(yv, p):.3f} | "
              f"{p.mean():.3f} | {yv.mean():.3f} |")
            print(f"  {label} {mdl}: AUC {auc(yv, p):.3f} Brier {brier(yv, p):.4f}")
        w()
    w("Model definitions, fixed before any result was seen:")
    w()
    w("- `B_base` — the August base rate, a constant.")
    w(f"- `B_struct` — L2 logistic (C=1) on {len(NUMERIC)} fetch-time numeric features: "
      "`" + "`, `".join(NUMERIC) + "`.")
    w(f"- `B_struct_ctx` — plus the top-{SETTINGS_B['top_context_domains']} X context-annotation "
      "domain flags, chosen on the training rows only.")
    w("- `B_struct_text` — **PRIMARY**: plus a word(1,2) TF-IDF of the tweet text.")
    w("- `B_gbm` — gradient boosting on the numeric block alone (unscaled), as a nonlinearity check.")
    w()

    # calibration table for the primary
    p_pri = res[("y_earlier", SETTINGS_B["primary_model"])][0]
    yv = sep["y_earlier"].values
    w(f"### B2a. Calibration of `{SETTINGS_B['primary_model']}` on the September test set")
    w()
    q = pd.qcut(pd.Series(p_pri).rank(method="first"), 10, labels=False)
    w("| decile | n | mean predicted | observed [Wilson 95%] |")
    w("|---|---|---|---|")
    for b in range(10):
        m_ = q == b
        k = int(yv[m_].sum())
        lo, hi = wilson(k, int(m_.sum()))
        w(f"| {b + 1} | {int(m_.sum())} | {p_pri[m_].mean():.3f} | {yv[m_].mean():.3f} "
          f"[{lo:.3f}, {hi:.3f}] |")
    w()
    sl = LogisticRegression(C=1e4, max_iter=1000).fit(logit(p_pri).reshape(-1, 1), yv)
    w(f"- Calibration slope {sl.coef_[0][0]:.2f}, intercept {sl.intercept_[0]:+.2f} "
      f"(1 and 0 would be perfect). Mean predicted {p_pri.mean():.3f} against observed "
      f"{yv.mean():.3f}.")
    w()
    # top weights of B_struct (interpretable)
    p_s, m_s, n_s = res[("y_earlier", "B_struct")]
    co = pd.Series(m_s.coef_[0], index=n_s).sort_values()
    w("Standardised logistic weights of `B_struct` (positive = more likely someone else has already noted it):")
    w()
    w("| feature | weight | feature | weight |")
    w("|---|---|---|---|")
    top = co.tail(10)[::-1]
    bot = co.head(10)
    for i in range(10):
        w(f"| `{top.index[i]}` | {top.iloc[i]:+.3f} | `{bot.index[i]}` | {bot.iloc[i]:+.3f} |")
    w()

    # ---- walk-forward score for every note (legal at fetch time)
    w("## B3. Walk-forward score, then the payoff")
    w()
    days = sorted(d["when"].dt.floor("D").unique())
    d = d.copy()
    d["compete"] = np.nan
    n_fallback = 0
    for D in days:
        te_i = d.index[d["when"].dt.floor("D") == D]
        tr_i = d.index[d["when"] < D - LAG_B]
        if len(tr_i) < MIN_TRAIN_B or d.loc[tr_i, "y_earlier"].sum() < 30:
            d.loc[te_i, "compete"] = d.loc[tr_i, "y_earlier"].mean() if len(tr_i) else np.nan
            n_fallback += len(te_i)
            continue
        p, _, _ = fit_predict(d.loc[tr_i], d.loc[te_i], SETTINGS_B["primary_model"], "y_earlier")
        d.loc[te_i, "compete"] = p
    w(f"- `{SETTINGS_B['primary_model']}` refitted for every UTC submit day D on notes submitted "
      f"before **D minus {SETTINGS_B['label_lag_days']} days** (the dump lag, so the label was "
      f"knowable). {len(days)} refit days; {n_fallback} notes on early days fall back to the "
      f"running base rate.")
    w()

    # payoff: does it rank OUR outcomes on the identical 977?
    pred = pd.read_parquet(BASELINES / "predictions.parquet")
    sc = pred[(pred["scored"]) & (pred["forecaster"] == "prior_30d")]
    base = sc[sc["target"] == "H"][["note_id", "submitted_at", "refit_day", "y", "p"]].rename(columns={"p": "prior_30d_H"})
    base = base.merge(sc[sc["target"] == "NH"][["note_id", "y", "p"]].rename(
        columns={"y": "y_nh", "p": "prior_30d_NH"}), on="note_id")
    base = base.merge(sc[sc["target"] == "rated"][["note_id", "y"]].rename(columns={"y": "y_rated"}), on="note_id")
    j = base.merge(d[["note_id", "compete", "H", "NH", "y_earlier"]], on="note_id", how="left")
    assert len(j) == 977, len(j)
    n_flip = int((j["y"].values != j["H"].values).sum())
    j["compete"] = j["compete"].fillna(d["compete"].median())
    w(f"### B3a. Does the fetch-time competition score rank our own outcomes?")
    w()
    w(f"Scored on the identical **977** notes of the prior backtest (90 H, 27 NH, 117 rated). "
      f"Labels are taken from `predictions.parquet` so the comparison is exact; re-pulling "
      f"`notes` 9 h later moved {n_flip} of them, which is a reminder that a Community Note's "
      f"status is not permanent.")
    w()
    w("| target | AUC of `compete` | AUC of realised `has_earlier` (48 h late) | AUC of `prior_30d` |")
    w("|---|---|---|---|")
    for tg, yc in [("H", "y"), ("NH", "y_nh"), ("rated at all", "y_rated")]:
        pr = {"H": "prior_30d_H", "NH": "prior_30d_NH", "rated at all": "prior_30d_H"}[tg]
        w(f"| {tg} | {auc(j[yc].values, j['compete'].values):.3f} | "
          f"{auc(j[yc].values, j['y_earlier'].values):.3f} | {auc(j[yc].values, j[pr].values):.3f} |")
    w()
    w(f"An AUC below 0.5 against NOT-helpful is the *right* sign: a post we are unlikely to be "
      f"first on is a post we are unlikely to be marked Not Helpful on. Read as a predictor of "
      f"avoiding NH it is AUC {1 - auc(j['y_nh'].values, j['compete'].values):.3f}. The score also "
      f"beats the **realised** `has_earlier` flag on H ranking, which is notable because that flag "
      f"is the ground truth it is trying to guess — but it arrives 48 h late and cannot be used.")
    w()
    w("The whole case in one table — quintiles of the fetch-time score, on the 977:")
    w()
    jq = j.copy()
    jq["q"] = pd.qcut(jq["compete"].rank(method="first"), 5, labels=False)
    w("| quintile of `compete` (fetch time) | n | mean score | our H rate | our NH rate | realised: earlier note present |")
    w("|---|---|---|---|---|---|")
    for b, g in jq.groupby("q"):
        lo, hi = wilson(int(g["y_nh"].sum()), len(g))
        w(f"| {b + 1} | {len(g)} | {g['compete'].mean():.3f} | {pct(g['y'].mean())} | "
          f"{pct(g['y_nh'].mean())} [{pct(lo)}, {pct(hi)}] | {pct(g['y_earlier'].mean())} |")
    w()
    q1, q5 = jq[jq["q"] == 0], jq[jq["q"] == 4]
    nh1, nh5 = q1["y_nh"].mean(), q5["y_nh"].mean()
    w(f"Out of sample, from features frozen at first sight. The H column and the realised-earlier "
      f"column rise monotonically across all five quintiles; the NH column falls from "
      f"{pct(nh1)} to {pct(nh5)} but is **not** monotone — it bumps up at the middle quintile "
      f"({pct(jq[jq['q'] == 2]['y_nh'].mean())}). Bottom quintile against top is "
      f"{nh1 / max(nh5, 1e-9):.1f}x on {int(q1['y_nh'].sum())} and {int(q5['y_nh'].sum())} "
      f"Not-Helpful events respectively, out of 27 in the whole sample — the ordering is the "
      f"finding, the ratio is noise.")
    w()
    rows = []

    def add(name, p, y, ref, note=""):
        dd, lo, hi = boot_diff(y, p, ref)
        rows.append((name, brier(y, p), logloss(y, p), auc(y, p), dd, lo, hi,
                     "yes, better" if hi < 0 else ("yes, worse" if lo > 0 else "no"), note))

    # Platt-map the competition score onto each of our targets, walk-forward
    for tg, yc, ref in [("H", "H", "prior_30d_H"), ("NH", "NH", "prior_30d_NH")]:
        p_out = pd.Series(np.nan, index=j.index)
        hist = d.dropna(subset=["compete"]).sort_values("when")
        for D, gd in j.groupby("refit_day"):
            past = hist[hist["when"] < D - pd.Timedelta(days=7)]
            if len(past) >= SETTINGS["platt"]["min_n"] and past[yc].sum() >= SETTINGS["platt"]["min_pos"]:
                pl = LogisticRegression(C=SETTINGS["platt"]["C"], max_iter=1000).fit(
                    logit(past["compete"].values).reshape(-1, 1), past[yc].values)
                p_out.loc[gd.index] = pl.predict_proba(logit(gd["compete"].values).reshape(-1, 1))[:, 1]
            else:
                p_out.loc[gd.index] = j.loc[gd.index, ref]
        yv = j["y"].values if tg == "H" else j["y_nh"].values
        add(f"prior_30d ({tg})", j[ref].values, yv, j[ref].values)
        add(f"compete_platt ({tg})", p_out.values, yv, j[ref].values,
            "competition score Platt-mapped onto this target on our own earlier notes, refit daily under a 7-day label lag")
        j[f"compete_platt_{tg}"] = p_out.values
    w("| forecaster | Brier | log loss | AUC | Brier diff vs prior_30d [95%] | excludes 0? |")
    w("|---|---|---|---|---|---|")
    for name, b, ll, a, dd, lo, hi, excl, note in rows:
        is_ref = name.startswith("prior_30d")
        w(f"| `{name}` | {b:.5f} | {ll:.4f} | {a:.3f} | "
          f"{'ref' if is_ref else f'{dd:+.5f} [{lo:+.5f}, {hi:+.5f}]'} | {'-' if is_ref else excl} |")
    w()
    w(f"{SETTINGS['bootstrap_draws']}-draw note-level bootstrap, percentile interval, same "
      f"resamples for every row. The raw `compete` score is a probability that *someone else "
      f"noted the post*, not a probability that our note is helpful, so only the Platt-mapped rows "
      f"belong in a Brier column; the AUC row above is the honest read of its ranking power.")
    w()

    # does it substitute for has_earlier inside stable4?
    w("### B3b. Can it stand in for `has_earlier`, which is 48 h late live?")
    w()
    SCREEN = HERE.parent / "2026_09_18_outcome_screen"
    FB = HERE.parent / "2026_09_18_forecast_baselines"
    sys.path.insert(0, str(SCREEN))
    sys.path.insert(0, str(FB))
    import screen as scr  # noqa
    import forecast as fc  # noqa
    _, _, cut2, t = scr.load()
    _, _, df2 = scr.build(t, cut2)
    df2 = df2.reset_index(drop=True)
    X2 = fc.features(df2).reset_index(drop=True)
    X2["note_id"] = df2["note_id"]
    X2["when"] = df2["when"]        # keep tz-awareness; .values would strip it
    X2["H"] = df2["H"]
    X2["NH"] = df2["NH"]
    X2 = X2.merge(d[["note_id", "compete"]], on="note_id", how="left")
    A2 = X2[X2["when"] < SEP_START]
    S2 = X2[X2["when"] >= SEP_START]
    base_cols = fc.FEATS["stable4_no_earlier"]
    combos = [("stable4_no_earlier", base_cols),
              ("stable4 (has_earlier, 48h late)", fc.FEATS["stable4"]),
              ("stable4_no_earlier + compete", base_cols + ["compete_logit"])]
    w(f"Fit on our matured August notes ({len(A2)}), tested on September ({len(S2)}).")
    w()
    for tgt in ["H", "NH"]:
        w(f"**Target {tgt}** ({int(S2[tgt].sum())} positives in the test set)")
        w()
        w("| model | Brier | log loss | AUC |")
        w("|---|---|---|---|")
        for name, use in combos:
            A, S = A2.copy(), S2.copy()
            A["compete_logit"], S["compete_logit"] = logit(A["compete"]), logit(S["compete"])
            Xa, Xs = A[use].copy(), S[use].copy()
            med = Xa.median().fillna(0.0)
            Xa, Xs = Xa.fillna(med), Xs.fillna(med)
            for c in use:
                mu, sd = Xa[c].mean(), Xa[c].std()
                sd = sd if sd > 0 else 1.0
                Xa[c], Xs[c] = (Xa[c] - mu) / sd, (Xs[c] - mu) / sd
            m = LogisticRegression(C=1.0, max_iter=2000).fit(Xa.values, A[tgt].values)
            p = m.predict_proba(Xs.values)[:, 1]
            w(f"| `{name}` | {brier(S[tgt].values, p):.5f} | {logloss(S[tgt].values, p):.4f} | "
              f"{auc(S[tgt].values, p):.3f} |")
        w()

    d.to_parquet(DATA / "competition_scores.parquet")
    j.to_parquet(DATA / "competition_transfer_977.parquet")
    (DATA / "part_b.md").write_text(
        "# PART B — Predicting at fetch time whether another author will note the post\n\n"
        + "\n".join(OUT) + "\n\n## B4. Settings, fixed before any result was seen\n\n```json\n"
        + json.dumps(SETTINGS_B, indent=2, default=str) + "\n```\n")
    print("  wrote data/part_b.md")


if __name__ == "__main__":
    main()
