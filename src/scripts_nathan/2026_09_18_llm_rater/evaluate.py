# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn", "statsmodels", "requests", "python-dotenv"]
# ///
"""Scores the LLM rater against the existing baselines. OFFLINE: reads
./data/ (my pull + ratings.jsonl), ../2026_09_18_forecast_baselines/data/
predictions.parquet and, read-only, the sibling screen's joins for the stable4
features. Writes the tables into RESULTS.md below the AUTO marker.

Leakage rules enforced here:
  * the rater is never fitted, so every matured note is out of sample for it;
  * any raw-score -> probability mapping (Platt, isotonic) is fitted ONLY on
    notes submitted before TEST_START and applied only to notes on/after it;
  * the incremental-value logistic is fitted on the same August block and
    tested on September;
  * the headline comparison is restricted to notes that are `scored` in
    predictions.parquet AND in the test period, so every forecaster is scored
    on the identical notes.

Run:  uv run evaluate.py
"""
import json, sys
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

from pairs import build_pairs
from rate import TOPICS, MODEL, SYSTEM, USER_TMPL

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
SCREEN = HERE.parent / "2026_09_18_outcome_screen"
BASE = HERE.parent / "2026_09_18_forecast_baselines"
MARKER = "<!-- AUTO-GENERATED BELOW THIS LINE BY evaluate.py; edits below are overwritten -->"

UTC = "UTC"
FIT_START = pd.Timestamp("2026-08-07", tz=UTC)
TEST_START = pd.Timestamp("2026-09-01", tz=UTC)
CLIP = (0.001, 0.999)
NBOOT = 2000
SEED = 0
SMALL_N = 30
STABLE4 = ["has_earlier", "age_h", "feed_missing", "hist_noH", "hist_H", "eval_score", "eval_missing"]
OUT = []


def w(s=""):
    OUT.append(s)


# ---------- stats ----------
def wilson(x, n, z=1.959964):
    if n == 0:
        return (np.nan, np.nan)
    p = x / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def pct(x, d=1):
    return "n/a" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{100 * x:.{d}f}%"


def cl(p):
    return np.clip(np.asarray(p, dtype=float), *CLIP)


def brier(y, p):
    return float(np.mean((cl(p) - np.asarray(y)) ** 2))


def logloss(y, p):
    p, y = cl(p), np.asarray(y)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def auc(y, p):
    y = np.asarray(y)
    return float("nan") if y.sum() in (0, len(y)) else float(roc_auc_score(y, p))


def logit(p):
    p = cl(p)
    return np.log(p / (1 - p))


def boot_idx(n, nboot=NBOOT, seed=SEED):
    rng = np.random.default_rng(seed)
    return rng.integers(0, n, size=(nboot, n))


def boot_diff(y, p, pref, idx):
    """Brier(p) - Brier(ref) with a percentile interval over the same draws."""
    y, p, pref = np.asarray(y), cl(p), cl(pref)
    d = (p - y) ** 2 - (pref - y) ** 2
    est = d.mean()
    draws = d[idx].mean(axis=1)
    lo, hi = np.percentile(draws, [2.5, 97.5])
    return est, lo, hi


def boot_auc_diff(y, pa, pb, idx):
    """AUC(a) - AUC(b) with a percentile interval over the same note draws."""
    y = np.asarray(y)
    est = auc(y, pa) - auc(y, pb)
    draws = []
    for row in idx:
        yy = y[row]
        if yy.sum() in (0, len(yy)):
            continue
        draws.append(roc_auc_score(yy, np.asarray(pa)[row]) - roc_auc_score(yy, np.asarray(pb)[row]))
    lo, hi = np.percentile(draws, [2.5, 97.5])
    return est, lo, hi


def excl(lo, hi, est):
    if lo > 0:
        return "yes, worse"
    if hi < 0:
        return "yes, better"
    return "no"


def cal_slope(y, p):
    """Logistic y ~ a + b*logit(p). b = 1 is perfect, b < 1 is over-confident."""
    y = np.asarray(y, dtype=float)
    X = sm.add_constant(logit(p))
    try:
        r = sm.Logit(y, X).fit(disp=0)
        ci = r.conf_int()[1]
        return r.params[1], ci[0], ci[1], r.params[0]
    except Exception:
        return (np.nan,) * 4


# ---------- load ----------
def load_ratings():
    recs = [json.loads(l) for l in (DATA / "ratings.jsonl").read_text().splitlines() if l.strip()]
    ok = pd.DataFrame([r for r in recs if r.get("ok")])
    bad = [r for r in recs if not r.get("ok")]
    ok = ok.sort_values("note_id").drop_duplicates("note_id", keep="last")
    cost = float(sum(r.get("cost") or 0.0 for r in recs))
    return ok, bad, cost, recs


def stable4_features():
    """Read-only reuse of the sibling screen's joins + the baseline's feature block."""
    sys.path.insert(0, str(SCREEN))
    sys.path.insert(0, str(BASE))
    from screen import load as screen_load, build as screen_build  # noqa: E402
    from forecast import features as base_features                 # noqa: E402
    _, _, sib_cutoff, t = screen_load()
    _, _, sdf = screen_build(t, sib_cutoff)
    X = base_features(sdf)
    X["note_id"] = sdf["note_id"].values
    return X.set_index("note_id"), sib_cutoff


def table(header, rows):
    w("| " + " | ".join(header) + " |")
    w("|" + "|".join(["---"] * len(header)) + "|")
    for r in rows:
        w("| " + " | ".join(str(c) for c in r) + " |")
    w()


# ---------- main ----------
def main():
    meta, pulled_at, cutoff, df = build_pairs()
    rat, bad, cost, recs = load_ratings()
    n_matured = len(df)
    d = df.merge(rat[["note_id", "p_helpful", "p_not_helpful", "topic", "engages", "reason",
                      "prompt_tokens", "completion_tokens"]], on="note_id", how="left")
    d["pH_llm"] = d["p_helpful"] / 100.0
    d["pNH_llm"] = d["p_not_helpful"] / 100.0
    rated_ok = d["pH_llm"].notna()
    d = d[rated_ok].copy()
    d["period"] = np.where(d["when"] < TEST_START, "fit(Aug)", "test(Sep)")
    fit = d[d["period"] == "fit(Aug)"].copy()
    test = d[d["period"] == "test(Sep)"].copy()

    # ---------------- sanity + joins ----------------
    w(MARKER)
    w()
    w("## 1. Sanity checks, joins and cost")
    w()
    w(f"- Pull time (DB `now()`): **{pulled_at}**. Maturity cutoff = pull time minus 7 days = **{cutoff}**.")
    w(f"- `notes` rows with `coalesce(submitted_at, first_seen_at) >= 2026-08-07`: {meta['n_window_notes']}; "
      f"matured (before the cutoff): **{n_matured}**; distinct tweets {df['tweet_id'].nunique()} "
      f"(one note per tweet: {df['tweet_id'].nunique() == n_matured}).")
    st = df["cn_status"].fillna("(null)").value_counts().to_dict()
    w(f"- `cn_status` in the matured set: {st}. H = CURRENTLY_RATED_HELPFUL, NH = CURRENTLY_RATED_NOT_HELPFUL, "
      "everything else (including null) is unresolved.")
    w(f"- Join to the submitting `pipeline_runs` row on `note_id`: {int(df['run_id'].notna().sum())} of {n_matured}; "
      f"note_text non-empty {int(df['note_text'].fillna('').str.strip().ne('').sum())}.")
    ts = df["tweet_text_source"].value_counts().to_dict()
    w(f"- Tweet text source: {ts} (feed_tweets first, `tweets` as the fallback; the column is kept in the data).")
    w(f"- `author_handle`: non-null in **0** of {len(df)} rows in *both* `feed_tweets` and `tweets` "
      "(the same finding as the sibling screen). The prompt therefore says `(handle not recorded)`; "
      "no handle was shown to the model.")
    w(f"- `materiality_engages` present for {int(df['mat_engages'].notna().sum())} of {n_matured} "
      f"(value counts {df['mat_engages'].value_counts(dropna=False).to_dict()}).")
    w(f"- Source URLs parsed from `pipeline_runs.source_url`: "
      f"{df['urls'].map(len).value_counts().sort_index().to_dict()} (urls per note).")
    w(f"- LLM calls: {len(rat)} successful, {len(bad)} permanently failed, "
      f"{n_matured - len(rat)} matured notes with no rating "
      f"(these are the ones with no note text / tweet text, so no prompt could be built).")
    w(f"- **Total OpenRouter cost: ${cost:.4f}** ({MODEL}); "
      f"prompt tokens {int(rat['prompt_tokens'].sum()):,}, completion tokens {int(rat['completion_tokens'].sum()):,}. "
      "Cost is OpenRouter's own `usage.cost`, not an estimate.")
    w(f"- Rated set used below: **{len(d)}** notes, H {int(d['H'].sum())}, NH {int(d['NH'].sum())}.")
    w()
    w(f"| block | window | n | H | H rate | NH | NH rate |")
    w("|---|---|---|---|---|---|---|")
    for nm, g in [("fit (Platt/isotonic/logistic fitted here)", fit), ("test (everything reported below)", test)]:
        w(f"| {nm} | {g['when'].min():%Y-%m-%d %H:%M} to {g['when'].max():%Y-%m-%d %H:%M} | {len(g)} | "
          f"{int(g['H'].sum())} | {pct(g['H'].mean())} | {int(g['NH'].sum())} | {pct(g['NH'].mean())} |")
    w()

    # ---------------- what the prompt contained ----------------
    w("## 2. Exactly what the prompt contained")
    w()
    w("Four strings and nothing else, assembled by `build_prompt()` in `rate.py` from a whitelisted "
      "column list (`PROMPT_COLS = tweet_text, author_handle, note_text, urls`):")
    w()
    w("1. the tweet text (first-sight `feed_tweets.text`, else `tweets.text`);")
    w("2. the author handle — **NULL in the database for every row**, so literally `(handle not recorded)`;")
    w("3. the note text (`pipeline_runs.note_text` of the submitting run);")
    w("4. the note's source URLs (parsed out of `pipeline_runs.source_url`).")
    w()
    w("Not in the prompt: the outcome, `cn_status`, any rating or view count, the submission date or time, "
      "the note's age, any pipeline score (evaluation, materiality, check), the A/B arm, the bot name, "
      "competing notes, author followers, feed tier, impressions, or anything else that happened after "
      "submission. The base-rate sentence in the system prompt ('about 1 in 10 helpful, about 1 in 30 "
      "not helpful') is a constant across all 2,045 calls and carries no per-note information, but it is "
      "outcome-derived at the population level and is declared here for that reason.")
    w()
    w("Verbatim system prompt:")
    w()
    w("```")
    w(SYSTEM)
    w("```")
    w()
    w("Verbatim user template (`{handle}`, `{tweet}`, `{note}`, `{urls}`, `{topics}` substituted):")
    w()
    w("```")
    w(USER_TMPL)
    w("```")
    w()
    w(f"Topic list, fixed before any outcome was looked at: `{', '.join(TOPICS)}`.")
    w()
    w("Model `" + MODEL + "`, temperature 0, strict JSON schema, one call per note, up to 5 retries on "
      "transient errors, every answer appended to `data/ratings.jsonl` as it lands. The first 713 calls "
      "ran at 8 concurrent; throughput fell to ~15/min so the remainder ran at 20. Concurrency changes "
      "nothing about the prompt or the answers.")
    w()

    # ---------------- raw calibration, all matured notes ----------------
    w("## 3. Raw calibration of the rater on every matured note")
    w()
    w("The rater is never fitted, so all " + str(len(d)) + " matured notes are out of sample for it. "
      "No recalibration anywhere in this section.")
    w()
    rows = []
    for tgt, col in [("H", "pH_llm"), ("NH", "pNH_llm")]:
        for nm, g in [("all matured", d), ("fit block (Aug)", fit), ("test block (Sep)", test)]:
            rows.append([tgt, nm, len(g), int(g[tgt].sum()), pct(g[tgt].mean()), pct(g[col].mean()),
                         f"{brier(g[tgt], g[col]):.5f}", f"{logloss(g[tgt], g[col]):.4f}",
                         f"{auc(g[tgt], g[col]):.3f}"])
    table(["target", "block", "n", "positives", "observed rate", "mean predicted", "Brier", "log loss", "AUC"], rows)
    for tgt, col in [("H", "pH_llm"), ("NH", "pNH_llm")]:
        b, lo, hi, a = cal_slope(d[tgt], d[col])
        q10, q90 = np.percentile(d[col], [10, 90])
        w(f"- **{tgt}**, all matured: calibration-in-the-large {pct(d[col].mean())} predicted vs "
          f"{pct(d[tgt].mean())} observed (over-prediction of {100 * (d[col].mean() - d[tgt].mean()):+.1f}pp); "
          f"calibration slope {b:.2f} [{lo:.2f}, {hi:.2f}]; sharpness (10th-90th pct of predictions) "
          f"{pct(q10)} to {pct(q90)}.")
    w()
    w("Raw prediction distributions (percentiles of the integer the model returned), all matured notes:")
    w()
    qs = [1, 5, 10, 25, 50, 75, 90, 95, 99]
    rows = []
    for nm, col in [("p_helpful", "p_helpful"), ("p_not_helpful", "p_not_helpful"), ("engages", "engages")]:
        v = np.percentile(d[col].values, qs)
        rows.append([nm, f"{d[col].min():.0f}", *[f"{x:.0f}" for x in v], f"{d[col].max():.0f}",
                     f"{d[col].nunique()}"])
    table(["field", "min", *[f"p{q}" for q in qs], "max", "distinct values"], rows)

    # ---------------- recalibration fitted on August ----------------
    w("## 4. Recalibration fitted on 2026-08-07 to 2026-08-31, applied to 2026-09-01 onward")
    w()
    maps = {}
    for tgt, col in [("H", "pH_llm"), ("NH", "pNH_llm")]:
        pl = LogisticRegression(C=1e4, max_iter=1000).fit(logit(fit[col]).reshape(-1, 1), fit[tgt].values)
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(fit[col].values, fit[tgt].values)
        for g in (d, fit, test):
            g[f"{col}_platt"] = pl.predict_proba(logit(g[col]).reshape(-1, 1))[:, 1]
            g[f"{col}_iso"] = iso.predict(g[col].values)
        maps[tgt] = (pl, iso)
        w(f"- **{tgt}**: Platt fitted on {len(fit)} August notes ({int(fit[tgt].sum())} positives); "
          f"intercept {pl.intercept_[0]:.3f}, slope {pl.coef_[0][0]:.3f}. Isotonic fitted on the same notes. "
          f"Neither ever sees a September note. On the test block the Platt map turns a mean raw prediction of "
          f"{pct(test[col].mean())} into {pct(test[f'{col}_platt'].mean())} (observed {pct(test[tgt].mean())}).")
    w()

    # ---------------- headline: identical note set ----------------
    pred = pd.read_parquet(BASE / "data" / "predictions.parquet")
    sc = pred[pred["scored"]]
    scored_ids = set(sc[sc["target"] == "H"]["note_id"])
    common = test[test["note_id"].isin(scored_ids)].copy()
    lab = sc[sc["target"] == "H"].drop_duplicates("note_id").set_index("note_id")["y"]
    disagree = int((common["note_id"].map(lab).values != common["H"].values).sum())

    w("## 5. Headline comparison on the identical note set")
    w()
    w(f"- `predictions.parquet` scores **{len(scored_ids)}** notes (2026-08-23 07:00 to 2026-09-11 18:39 UTC).")
    w(f"- My test period is 2026-09-01 onward. The intersection — scored there **and** in my test period — is "
      f"**{len(common)} notes**: H {int(common['H'].sum())} ({pct(common['H'].mean())}), "
      f"NH {int(common['NH'].sum())} ({pct(common['NH'].mean())}).")
    w(f"- Test notes dropped because the baselines never predicted them: **{len(test) - len(common)}** "
      "(submitted after the baselines' own maturity cutoff of 2026-09-11 19:05 UTC; my pull is ~9h later).")
    w(f"- Labels: I use my own fresher `cn_status` for every forecaster, so the comparison is apples to apples. "
      f"It disagrees with the `y` frozen in `predictions.parquet` on **{disagree}** of {len(common)} notes.")
    w()
    idx = boot_idx(len(common))
    base_names = ["prior_all", "prior_30d", "eval_only", "stable4", "stable4_platt", "gbm_canary"]
    for tgt, col in [("H", "pH_llm"), ("NH", "pNH_llm")]:
        wide = sc[sc["target"] == tgt].pivot(index="note_id", columns="forecaster", values="p")
        cand = {f"llm_raw": common[col].values,
                f"llm_platt": common[f"{col}_platt"].values,
                f"llm_isotonic": common[f"{col}_iso"].values}
        for nm in base_names:
            cand[nm] = common["note_id"].map(wide[nm]).values
        y = common[tgt].values
        ref = cand["prior_30d"]
        rows = []
        for nm, p in cand.items():
            e, lo, hi = boot_diff(y, p, ref, idx)
            skill = 1 - brier(y, p) / brier(y, ref)
            rows.append([f"`{nm}`", f"{brier(y, p):.5f}", "ref" if nm == "prior_30d" else f"{100 * skill:+.1f}%",
                         "ref" if nm == "prior_30d" else f"{e:+.5f} [{lo:+.5f}, {hi:+.5f}]",
                         "-" if nm == "prior_30d" else excl(lo, hi, e),
                         f"{logloss(y, p):.4f}", f"{auc(y, p):.3f}"])
        w(f"### Target {tgt} — {len(common)} notes, {int(y.sum())} positives ({pct(y.mean())})")
        w()
        table(["forecaster", "Brier", "skill vs prior_30d", "Brier diff vs prior_30d [bootstrap 95%]",
               "excludes 0?", "log loss", "AUC"], rows)
        if tgt == "H":
            head_rows = rows
    w("Brier difference is forecaster minus `prior_30d`, so negative is better. "
      f"{NBOOT} note-level bootstrap resamples, the same resamples for every row. "
      "Probabilities clipped to [0.001, 0.999] before every metric.")
    w()

    # ---------------- calibration tables ----------------
    w("## 6. Calibration on the test block")
    w()
    for tgt, col in [("H", "pH_llm"), ("NH", "pNH_llm")]:
        for variant in ["", "_platt", "_iso"]:
            c = col + variant
            nm = {"": "raw", "_platt": "Platt (fitted on August)", "_iso": "isotonic (fitted on August)"}[variant]
            g = test.copy()
            nb = 5
            g["bin"] = pd.qcut(g[c].rank(method="first"), nb, labels=False)
            rows = []
            for b, gb in g.groupby("bin"):
                x, n = int(gb[tgt].sum()), len(gb)
                lo, hi = wilson(x, n)
                rows.append([f"Q{b + 1}", n, pct(gb[c].mean()), f"{x}", pct(x / n),
                             f"[{pct(lo)}, {pct(hi)}]"])
            w(f"**{tgt}, {nm}** — quantile bins on the {len(g)} test notes:")
            w()
            table(["bin", "n", "mean predicted", "positives", "observed", "Wilson 95%"], rows)
            b_, lo_, hi_, a_ = cal_slope(g[tgt], g[c])
            q10, q90 = np.percentile(g[c], [10, 90])
            w(f"- calibration-in-the-large: {pct(g[c].mean())} predicted vs {pct(g[tgt].mean())} observed "
              f"({100 * (g[c].mean() - g[tgt].mean()):+.1f}pp); slope {b_:.2f} [{lo_:.2f}, {hi_:.2f}]; "
              f"sharpness 10th-90th pct {pct(q10)} to {pct(q90)}.")
            w()

    # ---------------- does it add to stable4? ----------------
    w("## 7. Does the LLM probability add anything to `stable4`?")
    w()
    X, sib_cutoff = stable4_features()
    have = d[d["note_id"].isin(X.index)].copy()
    hf = have[have["period"] == "fit(Aug)"]
    ht = have[have["period"] == "test(Sep)"]
    w(f"- Features come from the sibling screen's joins (read-only import). They exist for "
      f"{len(have)} of {len(d)} rated notes; the {len(d) - len(have)} misses are notes submitted after the "
      f"sibling's own maturity cutoff ({sib_cutoff}), which its `build()` never produced.")
    w(f"- Fitted on **{len(hf)}** August notes, tested on **{len(ht)}** September notes. "
      f"Missing feature values are imputed with the training-block median only.")
    w()
    rows = []
    for tgt, col in [("H", "pH_llm"), ("NH", "pNH_llm")]:
        idx2 = boot_idx(len(ht))
        Xtr, Xte = X.loc[hf["note_id"]].copy(), X.loc[ht["note_id"]].copy()
        out = {}
        for nm, cols, extra in [("stable4", STABLE4, None), ("stable4 + LLM p", STABLE4, col)]:
            A, B = Xtr[cols].copy(), Xte[cols].copy()
            if extra:
                A["llm_p"] = logit(hf[extra].values)
                B["llm_p"] = logit(ht[extra].values)
            med = A.median().fillna(0.0)
            A, B = A.fillna(med), B.fillna(med)
            mu, sd = A.mean(), A.std().replace(0, 1.0)
            A, B = (A - mu) / sd, (B - mu) / sd
            m = LogisticRegression(C=1.0, max_iter=1000).fit(A.values, hf[tgt].values)
            out[nm] = m.predict_proba(B.values)[:, 1]
        out["LLM p alone (Platt)"] = ht[col + "_platt"].values
        y = ht[tgt].values
        ref = out["stable4"]
        for nm, p in out.items():
            e, lo, hi = boot_diff(y, p, ref, idx2)
            rows.append([tgt, nm, f"{brier(y, p):.5f}",
                         "ref" if nm == "stable4" else f"{e:+.5f} [{lo:+.5f}, {hi:+.5f}]",
                         "-" if nm == "stable4" else excl(lo, hi, e),
                         f"{logloss(y, p):.4f}", f"{auc(y, p):.3f}"])
    table(["target", "model (fit Aug, test Sep)", "Brier", "Brier diff vs stable4 [bootstrap 95%]",
           "excludes 0?", "log loss", "AUC"], rows)

    # ---------------- topic ----------------
    w("## 8. Topic (descriptive only — nothing is fitted on topic)")
    w()
    w("Topics were fixed before any outcome was looked at. Cells with n < 30 are marked † and should not "
      "be read as evidence. August and September are shown separately so the drift in the base rate is visible.")
    w()
    for nm, g in [("August block (2026-08-07 to 2026-08-31)", fit), ("September block (2026-09-01 onward)", test)]:
        rows = []
        for tp in TOPICS + ["(all)"]:
            gg = g if tp == "(all)" else g[g["topic"] == tp]
            n = len(gg)
            if n == 0:
                rows.append([tp, 0, "-", "-", "-", "-"])
                continue
            h, nh = int(gg["H"].sum()), int(gg["NH"].sum())
            hl, hu = wilson(h, n)
            nl, nu = wilson(nh, n)
            flag = " †" if n < SMALL_N else ""
            rows.append([f"{tp}{flag}", n, h, f"{pct(h / n)} [{pct(hl)}, {pct(hu)}]", nh,
                         f"{pct(nh / n)} [{pct(nl)}, {pct(nu)}]"])
        w(f"**{nm}** (n={len(g)})")
        w()
        table(["topic", "n", "H", "H rate [Wilson 95%]", "NH", "NH rate [Wilson 95%]"], rows)

    # ---------------- engages ----------------
    w("## 9. The graded `engages` score vs the pipeline's binary `materiality_engages`")
    w()
    e = d[d["mat_engages"].notna()].copy()
    w(f"Both signals present for **{len(e)}** of {len(d)} rated notes. The binary flag comes from the live "
      "pipeline's materiality judge (`google/gemini-3-flash-preview`), which saw the post, the note **and the "
      "search findings**; the graded score comes from this rater, which saw the post, the note and the source "
      "URLs only. So this is a comparison of two different judges, not of two encodings of one judge.")
    w()
    rows = []
    for v in [0.0, 1.0]:
        g = e[e["mat_engages"] == v]
        n, h, nh = len(g), int(g["H"].sum()), int(g["NH"].sum())
        hl, hu = wilson(h, n); nl, nu = wilson(nh, n)
        rows.append([f"binary flag = {int(v)}", n, h, f"{pct(h / n)} [{pct(hl)}, {pct(hu)}]", nh,
                     f"{pct(nh / n)} [{pct(nl)}, {pct(nu)}]", f"{pct(g['engages'].mean() / 100)}"])
    e["eng_bin"] = pd.qcut(e["engages"].rank(method="first"), 5, labels=False)
    for b, g in e.groupby("eng_bin"):
        n, h, nh = len(g), int(g["H"].sum()), int(g["NH"].sum())
        hl, hu = wilson(h, n); nl, nu = wilson(nh, n)
        rows.append([f"graded Q{b + 1} ({g['engages'].min():.0f}-{g['engages'].max():.0f})", n, h,
                     f"{pct(h / n)} [{pct(hl)}, {pct(hu)}]", nh, f"{pct(nh / n)} [{pct(nl)}, {pct(nu)}]",
                     f"{pct(g['engages'].mean() / 100)}"])
    w(f"**All {len(e)} matured notes** (descriptive; the binary flag's split was found post hoc, the graded "
      "buckets are quintiles of a score fixed before any outcome was read):")
    w()
    table(["bucket", "n", "H", "H rate [Wilson 95%]", "NH", "NH rate [Wilson 95%]", "mean graded engages"], rows)

    idx3 = boot_idx(len(e))
    rows = []
    for tgt in ["H", "NH"]:
        y = e[tgt].values
        a_g, a_b = auc(y, -e["engages"].values), auc(y, -e["mat_engages"].values)
        est, lo, hi = boot_auc_diff(y, -e["engages"].values, -e["mat_engages"].values, idx3)
        rows.append([tgt, f"{a_g:.3f}", f"{a_b:.3f}", f"{est:+.3f} [{lo:+.3f}, {hi:+.3f}]",
                     "yes" if (lo > 0 or hi < 0) else "no"])
    w("Separation, all matured notes, scoring *lower engagement -> higher risk* (so AUC > 0.5 means low "
      "engagement predicts the outcome):")
    w()
    table(["target", "AUC graded (LLM)", "AUC binary (pipeline)", "AUC difference [bootstrap 95%]",
           "excludes 0?"], rows)

    ef, et = e[e["period"] == "fit(Aug)"].copy(), e[e["period"] == "test(Sep)"].copy()
    idx4 = boot_idx(len(et))
    rows = []
    for tgt in ["H", "NH"]:
        y = et[tgt].values
        preds = {}
        for nm, cols in [("binary flag only", ["mat_engages"]), ("graded engages only", ["engages"]),
                         ("both", ["mat_engages", "engages"])]:
            A, B = ef[cols].astype(float), et[cols].astype(float)
            mu, sd = A.mean(), A.std().replace(0, 1.0)
            m = LogisticRegression(C=1.0, max_iter=1000).fit(((A - mu) / sd).values, ef[tgt].values)
            preds[nm] = m.predict_proba(((B - mu) / sd).values)[:, 1]
        preds["base rate (Aug)"] = np.full(len(et), ef[tgt].mean())
        ref = preds["base rate (Aug)"]
        for nm, p in preds.items():
            est, lo, hi = boot_diff(y, p, ref, idx4)
            rows.append([tgt, nm, f"{brier(y, p):.5f}",
                         "ref" if nm.startswith("base") else f"{est:+.5f} [{lo:+.5f}, {hi:+.5f}]",
                         "-" if nm.startswith("base") else excl(lo, hi, est),
                         f"{logloss(y, p):.4f}", f"{auc(y, p):.3f}"])
    w(f"Out of sample: a one-feature logistic fitted on the {len(ef)} August notes and tested on the "
      f"{len(et)} September notes. This is the honest version of the question.")
    w()
    table(["target", "predictor (fit Aug, test Sep)", "Brier", "Brier diff vs base rate [bootstrap 95%]",
           "excludes 0?", "log loss", "AUC"], rows)

    # ---------------- tidy output so nothing needs re-calling ----------------
    keep = ["note_id", "tweet_id", "when", "cn_status", "H", "NH", "rated", "period",
            "p_helpful", "p_not_helpful", "topic", "engages", "reason",
            "pH_llm", "pH_llm_platt", "pH_llm_iso", "pNH_llm", "pNH_llm_platt", "pNH_llm_iso",
            "mat_engages", "tweet_text_source"]
    d[keep].to_parquet(DATA / "llm_predictions.parquet")

    # ---------------- write ----------------
    path = HERE / "RESULTS.md"
    body = "\n".join(OUT)
    if path.exists() and MARKER in path.read_text():
        head = path.read_text().split(MARKER)[0]
    else:
        head = "# LLM rater: an out-of-sample P(Helpful) forecast from the tweet and note text (2026-09-18)\n\n"
    path.write_text(head.rstrip("\n") + "\n\n" + body + "\n")
    print(f"wrote {path} ({len(body.splitlines())} generated lines)")
    print(f"\ncost ${cost:.4f}   rated {len(d)}   common set {len(common)}")
    for r in head_rows:
        print(r)


if __name__ == "__main__":
    main()
