"""Shared loading, feature building and model assembly for the corpus-transfer test.

OFFLINE. Reads ./data/*.parquet written by pull.py, plus (read-only) the walk-forward
predictions of ../2026_09_18_forecast_baselines/data/predictions.parquet.

EVERY hyperparameter in this file was fixed before any transfer result was looked at.
They are listed in SETTINGS and printed into RESULTS.md verbatim.
"""
import hashlib
import re
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
BASELINES = HERE.parent / "2026_09_18_forecast_baselines" / "data"

H, NH, NMR = "CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL", "NEEDS_MORE_RATINGS"
WINDOW_START = pd.Timestamp("2026-08-07", tz="UTC")
RECAL_SPLIT = pd.Timestamp("2026-09-01", tz="UTC")   # brief's temporal recalibration split
LAG = pd.Timedelta(days=7)

SETTINGS = dict(
    word_tfidf=dict(ngram_range=(1, 2), min_df=5, max_features=50000, sublinear_tf=True,
                    strip_accents="unicode", lowercase=True),
    char_tfidf=dict(analyzer="char_wb", ngram_range=(3, 5), min_df=5, max_features=50000,
                    sublinear_tf=True, lowercase=True),
    tweet_tfidf=dict(ngram_range=(1, 2), min_df=5, max_features=30000, sublinear_tf=True,
                     strip_accents="unicode", lowercase=True),
    logistic=dict(C=1.0, penalty="l2", max_iter=2000, solver="liblinear"),
    lsa=dict(n_components=200, random_state=0, logistic_C=0.1),
    top_domains=30,          # domain indicators, chosen on the TRAIN fold only
    group_kfold=5,
    time_split_quantile=0.75,  # train = corpus notes below this quantile of created_at_millis
    bootstrap_draws=2000,
    bootstrap_seed=0,
    clip=(0.001, 0.999),
    platt=dict(min_n=300, min_pos=15, C=1e4),   # identical to the prior backtest's recipe
)

HEDGE = ["may", "might", "could", "appears", "appear", "seems", "seem", "reportedly",
         "allegedly", "alleged", "likely", "unclear", "suggests", "suggest", "possibly",
         "apparently", "claims", "claimed", "no evidence", "unverified", "unconfirmed"]

URL_RE = re.compile(r"https?://\S+")
DOMAIN_RE = re.compile(r"https?://(?:www\.)?([A-Za-z0-9.\-]+)")


# ---------- text helpers ----------
def domains_of(text):
    return [d.lower().rstrip(".") for d in DOMAIN_RE.findall(text or "")]


def strip_urls(text):
    return URL_RE.sub(" ", text or "")


def structural_frame(texts):
    """Simple, interpretable structural features. No fitted state."""
    t = pd.Series(list(texts)).fillna("")
    body = t.map(strip_urls)
    urls = t.map(lambda s: URL_RE.findall(s))
    doms = t.map(domains_of)
    n_alpha = body.str.count(r"[A-Za-z]").clip(lower=1)
    hedge_rx = r"(?<![A-Za-z])(?:" + "|".join(re.escape(h) for h in HEDGE) + r")(?![A-Za-z])"
    X = pd.DataFrame({
        "len_chars": body.str.len(),
        "len_words": body.str.split().map(len),
        "n_urls": urls.map(len),
        "has_url": urls.map(lambda u: float(len(u) > 0)),
        "n_domains": doms.map(lambda d: len(set(d))),
        "n_digits": body.str.count(r"\d"),
        "has_number": (body.str.count(r"\d") > 0).astype(float),
        "n_pct": body.str.count(r"%"),
        "n_question": body.str.count(r"\?"),
        "n_exclaim": body.str.count(r"!"),
        "caps_ratio": body.str.count(r"[A-Z]") / n_alpha,
        "n_hedge": body.str.lower().str.count(hedge_rx),
        "n_sentences": body.str.count(r"[.!?]").clip(lower=1),
    })
    X["words_per_sentence"] = X["len_words"] / X["n_sentences"]
    return X.astype(float)


# ---------- loading ----------
def load():
    comp = pd.read_parquet(DATA / "competing_notes.parquet")
    comp["created"] = pd.to_datetime(comp["created_at_millis"], unit="ms", utc=True)
    comp["slice"] = np.where(comp["our_note_id"].isna(), "missed", "census")

    feed = pd.read_parquet(DATA / "tweet_text_feed.parquet")[["tweet_id", "text"]]
    feed["src"] = "feed_tweets"
    tw = pd.read_parquet(DATA / "tweet_text_tweets.parquet")[["tweet_id", "text"]]
    tw["src"] = "tweets"
    tweets = pd.concat([feed, tw[~tw["tweet_id"].isin(feed["tweet_id"])]], ignore_index=True)
    tweets = tweets.drop_duplicates("tweet_id")

    notes = pd.read_parquet(DATA / "notes.parquet")
    notes["when"] = notes["submitted_at"].fillna(notes["first_seen_at"])
    runs = pd.read_parquet(DATA / "pipeline_runs.parquet")
    by_note = runs.dropna(subset=["note_id"]).drop_duplicates("note_id").set_index("note_id")

    ours = notes[notes["when"] >= WINDOW_START].copy()
    ours["note_text"] = ours["note_id"].map(by_note["note_text"])
    ours["H"] = (ours["cn_status"] == H).astype(int)
    ours["NH"] = (ours["cn_status"] == NH).astype(int)
    ours = ours.merge(tweets.rename(columns={"text": "tweet_text"})[["tweet_id", "tweet_text"]],
                      on="tweet_id", how="left")

    comp = comp.merge(tweets.rename(columns={"text": "tweet_text", "src": "tweet_src"}),
                      on="tweet_id", how="left")
    return comp, tweets, notes, ours


def groups_for(df):
    """Group label that keeps (a) all notes on one tweet and (b) all copies of one note
    text in the same fold. Union-find over tweet_id and a hash of the note text, so an
    identical note posted on several tweets cannot straddle a split."""
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    keys = []
    for tid, txt in zip(df["tweet_id"], df["note_text"].fillna("")):
        h = "T#" + hashlib.md5(txt.strip().lower().encode()).hexdigest()[:16]
        t = "W#" + str(tid)
        union(t, h)
        keys.append(t)
    return np.array([find(k) for k in keys])


# ---------- design matrices ----------
class Design:
    """Fits every transform on the training rows only, then transforms the test rows."""

    def __init__(self, variant):
        self.variant = variant

    def fit_transform(self, tr, te):
        v = self.variant
        note_tr = tr["note_text"].fillna("").tolist()
        note_te = te["note_text"].fillna("").tolist()
        if v == "note_no_urls":
            note_tr = [strip_urls(t) for t in note_tr]
            note_te = [strip_urls(t) for t in note_te]

        blocks_tr, blocks_te, names = [], [], []

        if v != "struct_only":
            self.wv = TfidfVectorizer(**SETTINGS["word_tfidf"]).fit(note_tr)
            self.cv = TfidfVectorizer(**SETTINGS["char_tfidf"]).fit(note_tr)
            wtr, wte = self.wv.transform(note_tr), self.wv.transform(note_te)
            ctr, cte = self.cv.transform(note_tr), self.cv.transform(note_te)
            if v == "lsa200":
                sv = TruncatedSVD(n_components=SETTINGS["lsa"]["n_components"],
                                  random_state=SETTINGS["lsa"]["random_state"])
                joint = sparse.hstack([wtr, ctr]).tocsr()
                dtr = sv.fit_transform(joint)
                dte = sv.transform(sparse.hstack([wte, cte]).tocsr())
                mu, sd = dtr.mean(0), dtr.std(0)
                sd = np.where(sd > 0, sd, 1.0)
                blocks_tr.append(sparse.csr_matrix((dtr - mu) / sd))
                blocks_te.append(sparse.csr_matrix((dte - mu) / sd))
                names += [f"lsa_{i}" for i in range(dtr.shape[1])]
            else:
                blocks_tr += [wtr, ctr]
                blocks_te += [wte, cte]
                names += ["w:" + f for f in self.wv.get_feature_names_out()]
                names += ["c:" + f for f in self.cv.get_feature_names_out()]

        if v == "note_plus_tweet":
            tt_tr = tr["tweet_text"].fillna("").tolist()
            tt_te = te["tweet_text"].fillna("").tolist()
            self.tv = TfidfVectorizer(**SETTINGS["tweet_tfidf"]).fit(tt_tr)
            blocks_tr.append(self.tv.transform(tt_tr))
            blocks_te.append(self.tv.transform(tt_te))
            names += ["tw:" + f for f in self.tv.get_feature_names_out()]

        # structural block (standardised with training mean/sd)
        Str, Ste = structural_frame(tr["note_text"]), structural_frame(te["note_text"])
        mu, sd = Str.mean(), Str.std().replace(0, 1.0)
        blocks_tr.append(sparse.csr_matrix(((Str - mu) / sd).values))
        blocks_te.append(sparse.csr_matrix(((Ste - mu) / sd).values))
        names += ["s:" + c for c in Str.columns]

        # domain indicators, top-N by document frequency in the TRAIN rows only
        if v not in ("note_no_urls",):
            dtr = tr["note_text"].fillna("").map(lambda s: set(domains_of(s)))
            counts = pd.Series([d for s in dtr for d in s]).value_counts()
            self.domains = list(counts.head(SETTINGS["top_domains"]).index)
            dte = te["note_text"].fillna("").map(lambda s: set(domains_of(s)))
            Dtr = np.array([[float(d in s) for d in self.domains] for s in dtr])
            Dte = np.array([[float(d in s) for d in self.domains] for s in dte])
            blocks_tr.append(sparse.csr_matrix(Dtr))
            blocks_te.append(sparse.csr_matrix(Dte))
            names += ["d:" + d for d in self.domains]
        else:
            self.domains = []

        self.names = np.array(names)
        return sparse.hstack(blocks_tr).tocsr(), sparse.hstack(blocks_te).tocsr()


def fit_logistic(Xtr, ytr, variant):
    C = SETTINGS["lsa"]["logistic_C"] if variant == "lsa200" else SETTINGS["logistic"]["C"]
    kw = dict(SETTINGS["logistic"])
    kw["C"] = C
    return LogisticRegression(**kw).fit(Xtr, ytr)


def run_variant(tr, te, variant):
    """One fit. Returns test-set scores, the fitted model and the design (for weights)."""
    d = Design(variant)
    Xtr, Xte = d.fit_transform(tr, te)
    m = fit_logistic(Xtr, tr["y"].values, variant)
    return m.predict_proba(Xte)[:, 1], m, d


# ---------- metrics ----------
def auc(y, p):
    y = np.asarray(y)
    if y.sum() == 0 or y.sum() == len(y):
        return np.nan
    r = pd.Series(p).rank().values
    n1, n0 = y.sum(), (1 - y).sum()
    return (r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)


def brier(y, p):
    return float(np.mean((np.asarray(p) - np.asarray(y)) ** 2))


def logloss(y, p):
    p = np.clip(p, *SETTINGS["clip"])
    y = np.asarray(y)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def logit(p):
    p = np.clip(p, *SETTINGS["clip"])
    return np.log(p / (1 - p))


def boot_diff(y, pa, pb, draws=None, seed=None):
    """Note-level bootstrap of Brier(a) - Brier(b). Same resamples for every call."""
    draws = draws or SETTINGS["bootstrap_draws"]
    seed = SETTINGS["bootstrap_seed"] if seed is None else seed
    y, pa, pb = np.asarray(y), np.asarray(pa), np.asarray(pb)
    da = (pa - y) ** 2 - (pb - y) ** 2
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(y), size=(draws, len(y)))
    d = da[idx].mean(axis=1)
    return float(da.mean()), float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))


def wilson(x, n, z=1.959964):
    if n == 0:
        return (np.nan, np.nan)
    p = x / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))
