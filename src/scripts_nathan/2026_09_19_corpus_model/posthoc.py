# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn", "joblib"]
# ///
"""POST-HOC diagnostics, written AFTER reading run.py's weight tables.

These were not in the pre-registered set. They exist because two things in the top-25
weights needed testing rather than hand-waving:

  1. `w:nnn` is the single largest negative weight. "NNN" is contributor shorthand for
     "no note needed" — 966 census notes open with it. Our bot never writes one. So
     part of the in-corpus AUC is the model telling NOT_MISLEADING notes apart from
     correction notes, a distinction that does not exist inside our own output.
  2. `c:203`, `c:/203`, `c:s/205`, `w:2026 07`, `w:july 2026` are the leading digits of
     tweet ids inside cited x.com/.../status/ URLs, and dates. Snowflake ids encode
     time, so these are clocks, not quality.

Each diagnostic removes one of them and re-measures. Labelled post-hoc everywhere.
Run:  uv run posthoc.py
"""
import json
import re
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.model_selection import GroupKFold

sys.dont_write_bytecode = True
warnings.filterwarnings("ignore", category=FutureWarning)
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import (  # noqa: E402
    BASELINES, DATA, H, NMR, SETTINGS, WINDOW_START, auc, groups_for, load, run_variant, wilson,
)

NJOBS = 4
MISLEAD = "MISINFORMED_OR_POTENTIALLY_MISLEADING"
OUT = []


def w(s=""):
    OUT.append(s)


def pct(x, d=1):
    return "n/a" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{100 * x:.{d}f}%"


def mask_digits(s):
    return re.sub(r"\d", "#", s or "")


def evaluate(d, ours, our_tweets, label):
    """5-fold tweet-grouped CV, the fixed time split, and transfer AUC onto our 977."""
    gk = GroupKFold(n_splits=SETTINGS["group_kfold"])
    folds = list(gk.split(d, d["y"], d["grp"]))
    res = Parallel(n_jobs=NJOBS)(
        delayed(lambda tr, te: run_variant(d.iloc[tr], d.iloc[te], "note_tfidf")[0])(tr, te)
        for tr, te in folds)
    oof = np.zeros(len(d))
    for (tr, te), p in zip(folds, res):
        oof[te] = p
    cut = d["created_at_millis"].quantile(SETTINGS["time_split_quantile"])
    p_t, _, _ = run_variant(d[d["created_at_millis"] < cut], d[d["created_at_millis"] >= cut],
                            "note_tfidf")
    te_t = d[d["created_at_millis"] >= cut]
    pool = d[~d["tweet_id"].isin(our_tweets)]
    p_o, _, _ = run_variant(pool, ours, "note_tfidf")
    return dict(label=label, n=len(d), pos=int(d["y"].sum()),
                auc_tweet=auc(d["y"].values, oof), auc_time=auc(te_t["y"].values, p_t),
                pool_n=len(pool), pool_pos=int(pool["y"].sum()), transfer=p_o)


def main():
    t0 = time.time()
    comp, tweets, notes, ours = load()
    meta = json.loads((DATA / "pull_meta.json").read_text())
    cutoff = pd.Timestamp(meta["pulled_at_utc"]) - pd.Timedelta(days=7)
    ours = ours[ours["when"] < cutoff].copy().reset_index(drop=True)
    our_tweets = set(ours["tweet_id"])

    cen = comp[comp["slice"] == "census"]
    w("## 8. POST-HOC diagnostics (added after reading the weight table)")
    w()
    w("Not pre-registered. Written because two things in section 5c needed a test rather than "
      "a paragraph. Report them as post-hoc, because that is what they are.")
    w()

    # composition by classification
    w("### 8a. What `w:nnn` is, and why it matters")
    w()
    w("\"NNN\" is contributor shorthand for *no note needed*. It is the largest negative weight "
      "in the model, and it is real signal — but it separates a kind of note our bot never "
      "writes. Composition of the census slice by X's own `classification`:")
    w()
    w("| classification | n | H | H rate [Wilson 95%] | share opening with \"NNN\" |")
    w("|---|---|---|---|---|")
    for cl, g in cen.groupby(cen["classification"].fillna("(null)")):
        h = int((g["current_status"] == H).sum())
        lo, hi = wilson(h, len(g))
        nnn = g["note_text"].fillna("").str.match(r"\s*NNN\b", case=False).mean()
        w(f"| `{cl}` | {len(g)} | {h} | {pct(h / len(g))} [{pct(lo)}, {pct(hi)}] | {pct(nnn)} |")
    w()
    n_nnn = int(cen["note_text"].fillna("").str.contains(r"\bNNN\b", case=False).sum())
    w(f"{n_nnn} census notes contain the token. **Every note we write is a "
      f"MISINFORMED_OR_POTENTIALLY_MISLEADING correction**, so the diagnostic below refits on "
      f"that class alone — the population our own notes actually belong to.")
    w()

    base = cen[cen["current_status"].isin([H, NMR])].copy()
    base["y"] = (base["current_status"] == H).astype(int)

    variants = {
        "pre-registered primary (all classifications, digits kept)": (base, False),
        "post-hoc A: MISLEADING class only": (base[base["classification"] == MISLEAD].copy(), False),
        "post-hoc B: digits masked to `#`": (base.copy(), True),
        "post-hoc C: MISLEADING only AND digits masked": (base[base["classification"] == MISLEAD].copy(), True),
    }
    rows = []
    for lab, (d, mask) in variants.items():
        d = d.copy()
        o = ours.copy()
        if mask:
            d["note_text"] = d["note_text"].map(mask_digits)
            o["note_text"] = o["note_text"].fillna("").map(mask_digits)
        d["grp"] = groups_for(d)
        d = d.reset_index(drop=True)
        r = evaluate(d, o, our_tweets, lab)
        # transfer AUC on the identical 977
        pred = pd.read_parquet(BASELINES / "predictions.parquet")
        sc = pred[(pred["scored"]) & (pred["target"] == "H") & (pred["forecaster"] == "prior_30d")]
        o["score"] = r["transfer"]
        jj = sc[["note_id", "y"]].merge(o[["note_id", "score"]], on="note_id", how="left")
        jj["score"] = jj["score"].fillna(o["score"].median())
        r["auc_977"] = auc(jj["y"].values, jj["score"].values)
        rows.append(r)
        print(f"  {lab}: tweet {r['auc_tweet']:.3f} time {r['auc_time']:.3f} "
              f"transfer977 {r['auc_977']:.3f} ({time.time() - t0:.0f}s)")

    w("### 8b. What survives each removal")
    w()
    w("All four are the same model class and the same fixed hyperparameters; only the training "
      "text or the training rows change. `transfer AUC` is on the identical 977 notes.")
    w()
    w("| variant | corpus n | positives | AUC tweet split | AUC time split | transfer pool n | transfer AUC on our 977 |")
    w("|---|---|---|---|---|---|---|")
    for r in rows:
        w(f"| {r['label']} | {r['n']} | {r['pos']} | {r['auc_tweet']:.3f} | {r['auc_time']:.3f} | "
          f"{r['pool_n']} | **{r['auc_977']:.3f}** |")
    w()
    (DATA / "part_c.md").write_text("\n".join(OUT) + "\n")
    print(f"  done in {time.time() - t0:.0f}s -> data/part_c.md")


if __name__ == "__main__":
    main()
