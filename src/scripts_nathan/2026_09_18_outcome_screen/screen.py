# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy"]
# ///
"""Univariate outcome screen. Reads ./data/*.parquet (written by pull.py), builds
tweet-level features, writes the tables into RESULTS.md below the AUTO marker.
Everything above the marker in RESULTS.md is hand-written and is preserved.

No database access here. Run:  uv run screen.py
"""
import json, re
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
MARKER = "<!-- AUTO-GENERATED BELOW THIS LINE BY screen.py; edits below are overwritten -->"
UTC = "UTC"
A_START = pd.Timestamp("2026-08-07", tz=UTC)
B_START = pd.Timestamp("2026-08-26", tz=UTC)
SMALL_N = 30
H_STATUS, NH_STATUS = "CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL"

# Crude keyword topics. "ci" patterns are case-insensitive, "cs" are case-sensitive.
# All are matched on word boundaries against the tweet text. A tweet can match
# several topics or none.
KEYWORDS = {
    "politics/election": {
        "ci": ["trump", "biden", "harris", "obama", "president", "presidential", "congress", "senate", "senator",
               "democrat", "democrats", "republican", "republicans", "gop", "maga", "election", "elections",
               "vote", "votes", "voter", "voters", "voting", "ballot", "ballots", "governor", "white house",
               "supreme court", "parliament", "prime minister", "minister", "labour", "tory", "tories", "starmer",
               "farage", "liberals", "conservatives", "immigration", "immigrant", "immigrants", "migrants",
               "border", "deport", "deported", "deportation", "deportations", "tariff", "tariffs", "campaign",
               "administration", "legislation", "bill", "mayor", "politician", "politicians", "leftist", "leftists",
               "left-wing", "right-wing", "far-right", "far-left"],
        "cs": ["ICE", "DOJ", "FBI", "DOGE", "AOC"],
    },
    "war/conflict": {
        "ci": ["war", "wars", "ukraine", "ukrainian", "russia", "russian", "putin", "zelensky", "zelenskyy",
               "israel", "israeli", "gaza", "hamas", "hezbollah", "iran", "iranian", "palestine", "palestinian",
               "palestinians", "idf", "military", "missile", "missiles", "airstrike", "airstrikes", "troops",
               "army", "nato", "invasion", "ceasefire", "bomb", "bombs", "bombing", "bombed", "soldier",
               "soldiers", "genocide", "taiwan", "houthi", "houthis", "syria", "drone strike", "hostage",
               "hostages", "terrorist", "terrorists", "terrorism"],
        "cs": [],
    },
    "health/science": {
        "ci": ["vaccine", "vaccines", "vaccinated", "vaccination", "covid", "virus", "cancer", "doctor", "doctors",
               "hospital", "hospitals", "health", "healthcare", "medical", "medicine", "drug", "drugs", "autism",
               "disease", "diseases", "study", "studies", "scientist", "scientists", "science", "scientific",
               "research", "researchers", "climate", "nasa", "measles", "tylenol", "ozempic", "diet", "obesity",
               "mental health", "fluoride", "pandemic"],
        "cs": ["FDA", "CDC", "RFK", "WHO", "NIH"],
    },
    "celebrity/entertainment": {
        "ci": ["movie", "movies", "film", "films", "actor", "actress", "singer", "rapper", "album", "song", "songs",
               "netflix", "disney", "hollywood", "celebrity", "celebrities", "kardashian", "taylor swift",
               "beyonce", "drake", "kanye", "grammy", "grammys", "oscar", "oscars", "emmy", "emmys", "tv show",
               "trailer", "concert", "tour", "anime", "marvel", "star wars", "video game", "gaming", "gta",
               "box office", "streamer", "youtuber", "influencer", "kpop", "k-pop", "bts", "fans"],
        "cs": [],
    },
    "sports": {
        "ci": ["nfl", "nba", "mlb", "nhl", "ufc", "fifa", "wwe", "world cup", "premier league", "champions league",
               "football", "soccer", "basketball", "baseball", "tennis", "golf", "olympic", "olympics",
               "quarterback", "touchdown", "playoffs", "championship", "coach", "player", "players", "league",
               "season", "messi", "ronaldo", "lebron", "goal", "goals", "match", "striker", "transfer",
               "boxing", "fight", "knockout"],
        "cs": ["F1"],
    },
    "crypto/finance": {
        "ci": ["bitcoin", "btc", "ethereum", "crypto", "cryptocurrency", "token", "tokens", "memecoin", "solana",
               "stock", "stocks", "stock market", "nasdaq", "s&p", "dow jones", "interest rate", "interest rates",
               "inflation", "economy", "recession", "bank", "banks", "investor", "investors", "investment",
               "shares", "earnings", "ipo", "billion", "trillion", "gdp", "debt", "jobs report", "unemployment"],
        "cs": ["ETH", "SEC", "Fed"],
    },
    "AI/tech": {
        "ci": ["a.i.", "artificial intelligence", "chatgpt", "openai", "gpt", "grok", "claude", "gemini", "llm",
               "robot", "robots", "robotaxi", "tesla", "spacex", "starlink", "elon", "musk", "iphone", "google",
               "microsoft", "nvidia", "software", "startup", "algorithm", "deepfake", "ai-generated",
               "ai generated", "data center", "data centers", "chip", "chips", "semiconductor"],
        "cs": ["AI", "AGI", "Apple", "Meta"],
    },
}


# ---------- stats helpers ----------
def wilson(x, n, z=1.959964):
    if n == 0:
        return (np.nan, np.nan)
    p = x / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def newcombe(x1, n1, x2, n2):
    """Difference p1-p2 with Newcombe (method 10) 95% interval."""
    p1, p2 = x1 / n1, x2 / n2
    l1, u1 = wilson(x1, n1)
    l2, u2 = wilson(x2, n2)
    d = p1 - p2
    return d, d - np.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + np.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)


def pct(x, d=1):
    return "n/a" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{100 * x:.{d}f}%"


def pp(x, d=1):
    return "n/a" if np.isnan(x) else f"{100 * x:+.{d}f}pp"


def ivw(ests):
    """Inverse-variance pooled estimate over (est, se) pairs, with 95% CI."""
    ests = [(e, s) for e, s in ests if s and not np.isnan(s) and s > 0]
    if not ests:
        return np.nan, np.nan, np.nan
    w = np.array([1 / s ** 2 for _, s in ests])
    e = np.array([e for e, _ in ests])
    m = (w * e).sum() / w.sum()
    se = 1 / np.sqrt(w.sum())
    return m, m - 1.96 * se, m + 1.96 * se


def rd_se(x1, n1, x2, n2):
    """Agresti-Caffo style SE for a risk difference (stable with zero cells)."""
    p1, p2 = (x1 + 1) / (n1 + 2), (x2 + 1) / (n2 + 2)
    return np.sqrt(p1 * (1 - p1) / (n1 + 2) + p2 * (1 - p2) / (n2 + 2))


# ---------- load + build ----------
def load():
    meta = json.loads((DATA / "pull_meta.json").read_text())
    pulled_at = pd.Timestamp(meta["pulled_at_utc"])
    cutoff = pulled_at - pd.Timedelta(days=7)
    t = {n: pd.read_parquet(DATA / f"{n}.parquet") for n in
         ["notes", "pipeline_runs", "pipeline_scores", "feed_tweets", "author_ids_feed_tweets",
          "author_ids_tweets", "competing_notes"]}
    return meta, pulled_at, cutoff, t


def kw_flags(text):
    out = {}
    for topic, pats in KEYWORDS.items():
        hit = False
        if pats["ci"]:
            rx = r"(?<![A-Za-z0-9])(?:" + "|".join(re.escape(k) for k in pats["ci"]) + r")(?![A-Za-z0-9])"
            hit = bool(re.search(rx, text, flags=re.I))
        if not hit and pats["cs"]:
            rx = r"(?<![A-Za-z0-9])(?:" + "|".join(re.escape(k) for k in pats["cs"]) + r")(?![A-Za-z0-9])"
            hit = bool(re.search(rx, text))
        out[topic] = hit
    return out


def build(t, cutoff):
    notes = t["notes"].copy()
    notes["when"] = notes["submitted_at"].fillna(notes["first_seen_at"])
    notes["H"] = (notes["cn_status"] == H_STATUS).astype(int)
    notes["NH"] = (notes["cn_status"] == NH_STATUS).astype(int)
    notes["rated"] = notes["H"] + notes["NH"]

    # author identity for every note we ever wrote (feed_tweets first, then tweets).
    # author_handle is NULL throughout both tables, so the key is author_id.
    auth = pd.concat([t["author_ids_feed_tweets"], t["author_ids_tweets"]]).dropna(subset=["author_id"])
    auth = auth.drop_duplicates("tweet_id")[["tweet_id", "author_id"]]
    notes = notes.merge(auth, on="tweet_id", how="left")

    win_all = notes[notes["when"] >= A_START]
    df = win_all[win_all["when"] < cutoff].copy()
    df["period"] = np.where(df["when"] < B_START, "A", "B")

    # --- run join: by note_id; fallback tweet_id + outcome='submitted'
    runs = t["pipeline_runs"]
    by_note = runs.dropna(subset=["note_id"]).drop_duplicates("note_id").set_index("note_id")
    df["run_id"] = df["note_id"].map(by_note["run_id"])
    df["run_join"] = np.where(df["run_id"].notna(), "note_id", "none")
    sub = runs[runs["outcome"] == "submitted"].sort_values("created_at").drop_duplicates("tweet_id", keep="last")
    fb = df["run_id"].isna() & df["tweet_id"].isin(sub["tweet_id"])
    df.loc[fb, "run_id"] = df.loc[fb, "tweet_id"].map(sub.set_index("tweet_id")["run_id"])
    df.loc[fb, "run_join"] = "tweet_id"
    sc = t["pipeline_scores"].sort_values("created_at").drop_duplicates("run_id", keep="last")
    df["eval_score"] = df["run_id"].map(sc.set_index("run_id")["score_value"])

    # --- feed_tweets join (first-sight values only)
    feed = t["feed_tweets"].drop(columns=["author_id"]).rename(columns={"first_seen_at": "feed_first_seen_at"})
    df = df.merge(feed, on="tweet_id", how="left", indicator="feed_join")
    df["has_feed"] = df["feed_join"] == "both"

    # --- competing notes (joined on tweet_id, deduped on note id)
    comp = t["competing_notes"].drop_duplicates(["tweet_id", "note_id"])
    sub_ms = df.set_index("tweet_id")["when"].map(lambda x: x.value // 10 ** 6)  # one note per tweet (checked in sanity)
    comp = comp[comp["tweet_id"].isin(sub_ms.index)].copy()
    comp["our_ms"] = comp["tweet_id"].map(sub_ms)
    comp["before"] = comp["created_at_millis"] < comp["our_ms"]
    comp["before_H_now"] = comp["before"] & (comp["current_status"] == H_STATUS)
    g = comp.groupby("tweet_id").agg(n_comp=("note_id", "size"), n_before=("before", "sum"),
                                     n_before_H=("before_H_now", "sum"))
    df = df.merge(g, on="tweet_id", how="left")
    df["any_comp_row"] = df["n_comp"].notna()
    df[["n_comp", "n_before", "n_before_H"]] = df[["n_comp", "n_before", "n_before_H"]].fillna(0).astype(int)

    # --- author history, out of time: our notes on the same author submitted more than
    # 7 days before this note, so their label was (99.5%) final when this note went out.
    hist = notes.dropna(subset=["author_id"])[["author_id", "when", "H"]].sort_values("when")
    groups = {a: (g["when"].values, g["H"].values) for a, g in hist.groupby("author_id")}
    n_prior, n_prior_H = [], []
    for a, w in zip(df["author_id"], df["when"]):
        if pd.isna(a) or a not in groups:
            n_prior.append(np.nan); n_prior_H.append(np.nan); continue
        ws, hs = groups[a]
        k = np.searchsorted(ws, np.datetime64((w - pd.Timedelta(days=7)).tz_convert(None)), side="left")
        n_prior.append(k); n_prior_H.append(int(hs[:k].sum()))
    df["n_prior"], df["n_prior_H"] = n_prior, n_prior_H
    return notes, win_all, df


def add_features(df):
    f = {}
    # 1
    f["prior_notes"] = pd.cut(df["n_before"], [-1, 0, 1, 3, 10 ** 6], labels=["0", "1", "2-3", "4+"]).astype(str)
    f["prior_notes_H_now"] = np.select(
        [df["n_before"] == 0, df["n_before_H"] > 0], ["no earlier note", "earlier note, >=1 rated H today"],
        "earlier note, none rated H today")
    # 2
    f["author_history"] = np.select(
        [df["n_prior"].isna(), df["n_prior"] == 0, df["n_prior_H"] > 0],
        ["(author id missing)", "no history", "history, >=1 H"], "history, none H")
    # 4-6
    hrs = (df["feed_first_seen_at"] - df["posted_at"]).dt.total_seconds() / 3600
    vel = df["first_seen_impressions"] / hrs.clip(lower=0.25)
    df["age_h"], df["velocity"] = hrs, vel
    f["velocity"] = pd.cut(vel, [-1, 5e3, 15e3, 5e4, 1e15], labels=["<5k/h", "5-15k/h", "15-50k/h", "50k+/h"], right=False).astype(str)
    f["feed_size"] = df["first_seen_feed_size"].astype(str)
    f["age"] = pd.cut(hrs, [-1, 3, 12, 24, 1e9], labels=["<3h", "3-12h", "12-24h", "24h+"], right=False).astype(str)
    f["followers"] = pd.cut(df["author_followers"], [-1, 1e4, 1e5, 1e6, 1e15], labels=["<10k", "10k-100k", "100k-1M", "1M+"], right=False).astype(str)
    # 7
    hv, hp = df["has_video"].fillna(False).astype(bool), df["has_photo"].fillna(False).astype(bool)
    f["media"] = np.select([hv, hp], ["video", "photo"], "none")
    ref = df["referenced_tweets"].map(lambda s: [r.get("type") for r in json.loads(s)] if isinstance(s, str) and s != "null" else [])
    f["is_reply"] = ref.map(lambda l: "reply" if "replied_to" in l else "not reply")
    f["is_quote"] = ref.map(lambda l: "quote" if "quoted" in l else "not quote")
    # 8
    pm = df["public_metrics"].map(lambda s: json.loads(s) if isinstance(s, str) else {})
    imp = pm.map(lambda d: d.get("impression_count") or np.nan)
    df["reply_ratio"] = pm.map(lambda d: d.get("reply_count", np.nan)) / imp
    df["quote_ratio"] = pm.map(lambda d: d.get("quote_count", np.nan)) / imp
    cuts = {}
    for col in ["reply_ratio", "quote_ratio"]:
        q = df.loc[df["has_feed"], col].quantile([1 / 3, 2 / 3]).values
        cuts[col] = q
        f[col] = pd.cut(df[col], [-1, q[0], q[1], 1e9], labels=["low", "mid", "high"]).astype(str)
    # 9
    f["lang"] = np.where(df["lang"] == "en", "en", "other")
    # 10 (not feed-dependent)
    f["eval_score"] = pd.cut(df["eval_score"], [-1e9, 0, 0.5, 1, 1e9], labels=["<0", "0-0.5", "0.5-1", ">=1"], right=False).astype(str)
    for k, v in f.items():
        v = pd.Series(np.asarray(v, dtype=object), index=df.index)
        df["f_" + k] = v.where(v.notna() & (v != "nan"), np.nan)  # same behaviour on pandas 2 and 3
    df["f_eval_score"] = df["f_eval_score"].fillna("missing")
    feed_dep = ["velocity", "feed_size", "age", "followers", "media", "is_reply", "is_quote", "reply_ratio", "quote_ratio", "lang"]
    for k in feed_dep:
        df.loc[~df["has_feed"], "f_" + k] = np.nan

    # 3: topics (non-exclusive flags)
    ann = df["context_annotations"].map(lambda s: json.loads(s) if isinstance(s, str) and s != "null" else [])
    df["domains"] = ann.map(lambda l: sorted({a["domain"]["name"] for a in l or []}))
    df["entities"] = ann.map(lambda l: sorted({a["entity"]["name"] for a in l or []}))
    kw = df["text"].fillna("").map(kw_flags)
    for topic in KEYWORDS:
        df["kw_" + topic] = kw.map(lambda d: d[topic])
    df["kw_none"] = ~df[["kw_" + t for t in KEYWORDS]].any(axis=1)
    return df, cuts


# ---------- tables ----------
def row_stats(g):
    n, h, nh = len(g), int(g["H"].sum()), int(g["NH"].sum())
    hl, hu = wilson(h, n)
    rl, ru = wilson(h + nh, n)
    return dict(n=n, H=h, NH=nh, h_rate=h / n if n else np.nan, hl=hl, hu=hu, nh_rate=nh / n if n else np.nan,
                r_rate=(h + nh) / n if n else np.nan, rl=rl, ru=ru, h_of_rated=h / (h + nh) if h + nh else np.nan)


def fmt_row(period, label, s):
    flag = " †" if s["n"] < SMALL_N else ""
    hr = f"{s['H']}/{s['H'] + s['NH']}" if s["H"] + s["NH"] else "0/0"
    return (f"| {period} | {label}{flag} | {s['n']} | {s['H']} | {s['NH']} | {pct(s['h_rate'])} [{pct(s['hl'])}, {pct(s['hu'])}] | "
            f"{pct(s['nh_rate'])} | {pct(s['r_rate'])} [{pct(s['rl'])}, {pct(s['ru'])}] | {pct(s['h_of_rated'], 0)} ({hr}) |")


HEAD = ("| period | bucket | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |\n"
        "|---|---|---|---|---|---|---|---|---|")


def table_exclusive(df, col, order):
    out = [HEAD]
    for p in ["A", "B"]:
        d = df[(df["period"] == p) & df[col].notna()]
        out.append(fmt_row(p, "**all with this feature (base)**", row_stats(d)))
        for b in order:
            out.append(fmt_row(p, b, row_stats(d[d[col] == b])))
    return "\n".join(out)


def table_flags(df, flags, universe):
    """flags: list of (label, boolean Series). Non-exclusive rows."""
    out = [HEAD]
    for p in ["A", "B"]:
        d = df[(df["period"] == p) & universe]
        out.append(fmt_row(p, "**all with this feature (base)**", row_stats(d)))
        for label, s in flags:
            out.append(fmt_row(p, label, row_stats(d[s.loc[d.index]])))
    return "\n".join(out)


RESULTS = []  # (feature, contrast, outcome, verdict, detail dict)


def contrast_binary(df, name, in_a, in_b, label):
    """Risk difference (group a minus group b) per period, for H rate and rated-at-all."""
    lines = []
    for outcome, oname in [("H", "H rate"), ("rated", "rated at all")]:
        per, small = {}, False
        for p in ["A", "B"]:
            d = df[df["period"] == p]
            ga, gb = d[in_a.loc[d.index]], d[in_b.loc[d.index]]
            if len(ga) < SMALL_N or len(gb) < SMALL_N:
                small = True
            if len(ga) == 0 or len(gb) == 0:
                per[p] = None; continue
            x1, n1, x2, n2 = int(ga[outcome].sum()), len(ga), int(gb[outcome].sum()), len(gb)
            d_, lo, hi = newcombe(x1, n1, x2, n2)
            pv = stats.fisher_exact([[x1, n1 - x1], [x2, n2 - x2]])[1]
            per[p] = dict(d=d_, lo=lo, hi=hi, p=pv, se=rd_se(x1, n1, x2, n2), n1=n1, n2=n2)
        verdict, pooled = judge(per, small, key="d")
        RESULTS.append((name, label, oname, verdict, per, pooled))
        bits = [f"{p}: {pp(per[p]['d'])} [{pp(per[p]['lo'])}, {pp(per[p]['hi'])}], Fisher p={per[p]['p']:.3f} (n={per[p]['n1']} vs {per[p]['n2']})"
                if per[p] else f"{p}: empty" for p in ["A", "B"]]
        pool = f"; period-stratified pooled {pp(pooled[0])} [{pp(pooled[1])}, {pp(pooled[2])}]" if not np.isnan(pooled[0]) else ""
        lines.append(f"- {label}, {oname}: " + "; ".join(bits) + pool + f" → **{verdict}**")
    return "\n".join(lines)


def contrast_trend(df, name, col, order, label):
    """Linear-probability slope per ordered band (pp per band) per period."""
    lines = []
    idx = {b: i for i, b in enumerate(order)}
    for outcome, oname in [("H", "H rate"), ("rated", "rated at all")]:
        per, small = {}, False
        for p in ["A", "B"]:
            d = df[(df["period"] == p) & df[col].isin(order)]
            x = d[col].map(idx).astype(float)
            sizes = d[col].value_counts()
            if (sizes >= SMALL_N).sum() < 2 or x.nunique() < 2:
                small = True
            if x.nunique() < 2:
                per[p] = None; continue
            lr = stats.linregress(x, d[outcome].astype(float))
            per[p] = dict(d=lr.slope, lo=lr.slope - 1.96 * lr.stderr, hi=lr.slope + 1.96 * lr.stderr, p=lr.pvalue,
                          se=lr.stderr, n=len(d))
        verdict, pooled = judge(per, small, key="d")
        RESULTS.append((name, label, oname, verdict, per, pooled))
        bits = [f"{p}: {pp(per[p]['d'], 2)}/band [{pp(per[p]['lo'], 2)}, {pp(per[p]['hi'], 2)}], p={per[p]['p']:.3f} (n={per[p]['n']})"
                if per[p] else f"{p}: n/a" for p in ["A", "B"]]
        pool = f"; period-stratified pooled {pp(pooled[0], 2)}/band [{pp(pooled[1], 2)}, {pp(pooled[2], 2)}]" if not np.isnan(pooled[0]) else ""
        lines.append(f"- {label}, {oname}: " + "; ".join(bits) + pool + f" → **{verdict}**")
    return "\n".join(lines)


def judge(per, small, key):
    """Mechanical verdict, fixed before looking at outcomes.
    too few: a compared group has n<30 in either period.
    flips: the sign differs between periods.
    holds (both periods): same sign, pooled 95% CI excludes 0, and each period alone has p < 0.10.
    holds in sign (X carries it): same sign and pooled CI excludes 0, but one period alone has p >= 0.10.
    same sign, within noise: same sign but the pooled CI includes 0."""
    pooled = ivw([(per[p][key], per[p]["se"]) for p in per if per[p]])
    if small or any(per[p] is None for p in per):
        return "too few to tell", pooled
    sa, sb = np.sign(per["A"][key]), np.sign(per["B"][key])
    if sa == 0 or sb == 0 or sa != sb:
        return "flips", pooled
    if pooled[1] > 0 or pooled[2] < 0:
        if per["A"]["p"] < 0.10 and per["B"]["p"] < 0.10:
            return "holds (both periods)", pooled
        led = "A" if per["A"]["p"] < per["B"]["p"] else "B"
        return f"holds in sign ({led} carries it)", pooled
    return "same sign, within noise", pooled


def main():
    meta, pulled_at, cutoff, t = load()
    notes, win_all, df = build(t, cutoff)
    df, cuts = add_features(df)
    L = []
    w = L.append

    # ----- sanity
    w("## Sanity checks and joins\n")
    w(f"- Pull time (DB now): {pulled_at:%Y-%m-%d %H:%M} UTC. Maturity cutoff = pull time minus 7 days = {cutoff:%Y-%m-%d %H:%M} UTC.")
    w(f"- `notes` rows pulled (whole table, narrow columns): {len(notes)}. Notes with coalesce(submitted_at, first_seen_at) >= 2026-08-07: {len(win_all)} "
      f"(submitted_at null in {int(win_all['submitted_at'].isna().sum())}). Of those, matured (older than 7 days): **{len(df)}**; excluded as too young: {len(win_all) - len(df)}.")
    w(f"- One note per tweet in the matured set: {df['tweet_id'].is_unique} (distinct tweets {df['tweet_id'].nunique()}).")
    st = df["cn_status"].fillna("(null)").value_counts().to_dict()
    w(f"- cn_status in matured set: {st}. Null and any other status count as unresolved.")
    w("")
    w("| period | window (UTC) | n | H | NH | H rate [Wilson 95%] | NH rate | rated at all [Wilson 95%] | H/(H+NH) |\n|---|---|---|---|---|---|---|---|---|")
    for p, lab in [("A", "2026-08-07 to 2026-08-25"), ("B", f"2026-08-26 to {cutoff:%Y-%m-%d %H:%M}"), ("all", "pooled")]:
        d = df if p == "all" else df[df["period"] == p]
        s = row_stats(d)
        w(f"| {p} | {lab} | {s['n']} | {s['H']} | {s['NH']} | {pct(s['h_rate'])} [{pct(s['hl'])}, {pct(s['hu'])}] | {pct(s['nh_rate'])} | "
          f"{pct(s['r_rate'])} [{pct(s['rl'])}, {pct(s['ru'])}] | {pct(s['h_of_rated'], 0)} |")
    w("")
    w("Weekly H rate (context for the time confound):\n")
    w("| week starting | n | H | NH | H rate | rated at all |\n|---|---|---|---|---|---|")
    wk = df.assign(week=df["when"].dt.tz_convert(None).dt.to_period("W-THU").dt.start_time)
    for k, g in wk.groupby("week"):
        w(f"| {k:%Y-%m-%d} | {len(g)} | {g['H'].sum()} | {g['NH'].sum()} | {pct(g['H'].mean())} | {pct(g['rated'].mean())} |")
    w("")
    rj = df["run_join"].value_counts().to_dict()
    w(f"- Join to submitting run: by `pipeline_runs.note_id` = {rj.get('note_id', 0)}; by fallback `tweet_id` + outcome='submitted' = {rj.get('tweet_id', 0)}; "
      f"failed = {rj.get('none', 0)} of {len(df)} ({pct(1 - (df['run_join'] == 'none').mean())} joined).")
    w(f"- Evaluation score present: {int(df['eval_score'].notna().sum())} of {len(df)} ({pct(df['eval_score'].notna().mean())}). "
      f"Missing by period: A {int(df[df.period == 'A']['eval_score'].isna().sum())}, B {int(df[df.period == 'B']['eval_score'].isna().sum())}. "
      "Submit dates of the missing-score notes are listed under table 10.")
    w(f"- Join to `feed_tweets`: {int(df['has_feed'].sum())} of {len(df)} ({pct(df['has_feed'].mean())}). "
      f"Missing by period: A {int((~df[df.period == 'A']['has_feed']).sum())}, B {int((~df[df.period == 'B']['has_feed']).sum())}. "
      f"H rate of the notes that failed this join: {pct(df[~df['has_feed']]['H'].mean())} (n={int((~df['has_feed']).sum())}).")
    w(f"- At least one `competing_notes` row (any time, joined on tweet_id): {int(df['any_comp_row'].sum())} of {len(df)} ({pct(df['any_comp_row'].mean())}). "
      f"At least one created before our note: {int((df['n_before'] > 0).sum())} ({pct((df['n_before'] > 0).mean())}). "
      "A tweet with no row is treated as having 0 other notes; the table is filled from the full public dump for every tweet where our note appears in the dump.")
    w(f"- Author id available (feed_tweets, then `tweets`): {int(df['author_id'].notna().sum())} of {len(df)}. "
      f"`author_handle` is NULL in every pulled row of both tables, so author history is keyed on `author_id`. "
      f"Across all {len(notes)} notes we ever wrote, author id is known for {int(notes['author_id'].notna().sum())}; the gap is almost all Oct-Dec 2025 notes, which therefore cannot count as history.")
    w(f"- raw_tweet is written once at first sight (checked in code: `insertNewFeedTweets` never rewrites it) and "
      f"`public_metrics.impression_count` equals `first_seen_impressions` in {pct((df.loc[df.has_feed, 'public_metrics'].map(lambda s: json.loads(s).get('impression_count')) == df.loc[df.has_feed, 'first_seen_impressions']).mean())} of joined rows.")
    w("")

    # ----- verdict rule
    w("## How the verdicts are assigned\n")
    w("Fixed before reading the outcome tables. Each feature has one or two pre-declared contrasts (a two-group risk difference, or a linear slope across ordered bands). "
      "Each contrast is computed separately in period A and period B for two outcomes: H rate and rated-at-all rate.\n")
    w(f"- **too few to tell**: a compared group has n < {SMALL_N} in either period (for band trends: fewer than two bands with n >= {SMALL_N}).")
    w("- **flips**: the sign of the effect differs between A and B.")
    w("- **holds (both periods)**: same sign in both periods, the period-stratified pooled 95% interval (inverse-variance over A and B) excludes zero, and each period on its own has p < 0.10.")
    w("- **holds in sign (A or B carries it)**: same sign and the pooled interval excludes zero, but one period on its own has p >= 0.10, so the pooled result leans on the other period. "
      "This tier was split out from 'holds' after the first run because the single 'holds' label was too generous to effects that were strong in August and faint in September. The split only makes verdicts stricter.")
    w("- **same sign, within noise**: same sign in both periods but the pooled interval includes zero. Two periods agree in sign by chance half the time, so this is not evidence.")
    w(f"- Buckets with n < {SMALL_N} are marked †. Two-group intervals are Newcombe; band slopes are linear-probability slopes in percentage points per band.\n")

    F = df[df["has_feed"]]

    def section(title, note=None):
        w(f"\n## {title}\n")
        if note:
            w(note + "\n")

    # 1
    section("1. Already has Community Notes (other notes created before ours)",
            "Count of `competing_notes` rows on the tweet with `created_at_millis` before our submit time. All classifications counted, including NOT_MISLEADING notes. Knowable at submit time in principle.")
    o = ["0", "1", "2-3", "4+"]
    w(table_exclusive(df, "f_prior_notes", o)); w("")
    w(contrast_binary(df, "1 prior notes", df["n_before"] >= 1, df["n_before"] == 0, "1+ earlier notes vs 0"))
    w(contrast_trend(df, "1 prior notes", "f_prior_notes", o, "trend across 0 / 1 / 2-3 / 4+"))
    section("1b. Earlier note currently rated helpful (PARTLY LEAKY: competitor status is measured today)",
            "Indicative only. The competitor's `current_status` is today's value, so it includes ratings that arrived after we submitted. A tweet where another note ended up helpful is also a tweet where ours is less likely to be shown.")
    o = ["no earlier note", "earlier note, none rated H today", "earlier note, >=1 rated H today"]
    w(table_exclusive(df, "f_prior_notes_H_now", o)); w("")
    w(contrast_binary(df, "1b earlier note H today (leaky)", df["n_before_H"] > 0, (df["n_before"] > 0) & (df["n_before_H"] == 0),
                      "earlier note rated H today vs earlier notes none H"))

    # 2
    section("2. Our own history with the author (out of time)",
            "Our earlier notes on the same `author_id` submitted more than 7 days before this note. Their labels are today's `cn_status`, which is final by day 7 in 99.5% of cases, so the leak is small. History before Jan 2026 is invisible (no author id), which pushes some authors into 'no history'.")
    o = ["no history", "history, none H", "history, >=1 H", "(author id missing)"]
    w(table_exclusive(df, "f_author_history", o)); w("")
    w(contrast_binary(df, "2 author history", df["f_author_history"] == "history, >=1 H", df["f_author_history"] == "no history", "history with >=1 H vs no history"))
    w(contrast_binary(df, "2 author history", df["f_author_history"] == "history, >=1 H", df["f_author_history"] == "history, none H", "history with >=1 H vs history none H"))
    w(contrast_binary(df, "2 author history", df["f_author_history"] == "history, none H", df["f_author_history"] == "no history", "history none H vs no history"))

    # 3
    section("3a. Topic: X context_annotations domains (non-exclusive)",
            f"A tweet can carry several domains, so rows overlap and do not sum to the base. Top 12 domains by n across both periods, plus 'none' (no annotations: {int((F['domains'].map(len) == 0).sum())} of {len(F)}). Contrast for each row is 'has this domain' vs 'all other joined notes'.")
    dom_counts = Counter(d for l in F["domains"] for d in l)
    top_dom = [d for d, _ in dom_counts.most_common(12)]
    flags = [(d, df["domains"].map(lambda l, d=d: d in l)) for d in top_dom] + [("none", df["domains"].map(len) == 0)]
    w(table_flags(df, flags, df["has_feed"])); w("")
    for lab, s in flags:
        contrast_binary(F, "3a domain", s.loc[F.index], ~s.loc[F.index], f"domain '{lab}' vs rest")
    w("Contrasts for these rows are in the verdict roll-up at the end.")
    section("3b. Topic: most common context_annotations entities (non-exclusive)",
            "Top 12 entity names by n. Same layout as 3a.")
    ent_counts = Counter(e for l in F["entities"] for e in l)
    top_ent = [e for e, _ in ent_counts.most_common(12)]
    flags = [(e, df["entities"].map(lambda l, e=e: e in l)) for e in top_ent]
    w(table_flags(df, flags, df["has_feed"])); w("")
    for lab, s in flags:
        contrast_binary(F, "3b entity", s.loc[F.index], ~s.loc[F.index], f"entity '{lab}' vs rest")
    w("Contrasts for these rows are in the verdict roll-up at the end.")
    section("3c. Topic: crude keyword match on tweet text (non-exclusive)",
            "Word-boundary match on the tweet text. Lists are below so they can be judged; they are rough, overlap, and miss image-only or non-English posts.")
    for topic, pats in KEYWORDS.items():
        w(f"- **{topic}** — case-insensitive: {', '.join(pats['ci'])}" + (f"; case-sensitive: {', '.join(pats['cs'])}" if pats["cs"] else ""))
    w("")
    flags = [(tpc, df["kw_" + tpc]) for tpc in KEYWORDS] + [("no keyword matched", df["kw_none"])]
    w(table_flags(df, flags, df["has_feed"])); w("")
    for lab, s in flags:
        contrast_binary(F, "3c keyword", s.loc[F.index], ~s.loc[F.index], f"keyword '{lab}' vs rest")
    w("Contrasts for these rows are in the verdict roll-up at the end.")

    # 4
    section("4a. Velocity at first sight", "first_seen_impressions / max(hours from posted_at to first_seen_at, 0.25).")
    o = ["<5k/h", "5-15k/h", "15-50k/h", "50k+/h"]
    w(table_exclusive(df, "f_velocity", o)); w("")
    w(contrast_trend(df, "4a velocity", "f_velocity", o, "trend across velocity bands"))
    section("4b. Feed tier at first sight (`first_seen_feed_size`)",
            "Feed size is an A/B arm whose mix changed over time, so it is confounded with date inside each period.")
    o = [x for x in ["small", "large", "xl", "xxl"] if x in set(F["f_feed_size"])]
    w(table_exclusive(df, "f_feed_size", o)); w("")
    w(contrast_trend(df, "4b feed size", "f_feed_size", o, "trend across small / large / xl"))
    # 5
    section("5. Tweet age at first sight", f"Hours from posted_at to first_seen_at. Maximum observed is {F['age_h'].max():.1f}h, so the 24h+ band is empty by construction of the feed.")
    o = ["<3h", "3-12h", "12-24h", "24h+"]
    w(table_exclusive(df, "f_age", o)); w("")
    w(contrast_trend(df, "5 age", "f_age", o[:3], "trend across <3h / 3-12h / 12-24h"))
    w(contrast_binary(F, "5 age", F["f_age"] == "3-12h", F["f_age"] != "3-12h", "3-12h vs other ages (the old 'fresh' flag)"))
    # 6
    section("6. Author size", "`author_followers` from feed_tweets. Note: this column can be refreshed if a later capture run re-sees the tweet; follower counts move slowly, so the leak is judged negligible, but it is not a strict first-sight value.")
    o = ["<10k", "10k-100k", "100k-1M", "1M+"]
    w(table_exclusive(df, "f_followers", o)); w("")
    w(contrast_trend(df, "6 followers", "f_followers", o, "trend across follower bands"))
    w(contrast_binary(F, "6 followers", F["f_followers"] != "1M+", F["f_followers"] == "1M+", "under 1M vs 1M+ (the old 'small author' flag)"))
    # 7
    section("7a. Media", "video = has_video (including the rows that have both video and photo); photo = has_photo only.")
    o = ["video", "photo", "none"]
    w(table_exclusive(df, "f_media", o)); w("")
    w(contrast_binary(F, "7a media", F["f_media"] != "none", F["f_media"] == "none", "any media vs none"))
    w(contrast_binary(F, "7a media", F["f_media"] == "video", F["f_media"] == "photo", "video vs photo"))
    section("7b. Is reply / is quote (from referenced_tweets)")
    w(table_exclusive(df, "f_is_reply", ["reply", "not reply"])); w("")
    w(contrast_binary(F, "7b reply", F["f_is_reply"] == "reply", F["f_is_reply"] == "not reply", "reply vs not"))
    w("")
    w(table_exclusive(df, "f_is_quote", ["quote", "not quote"])); w("")
    w(contrast_binary(F, "7b quote", F["f_is_quote"] == "quote", F["f_is_quote"] == "not quote", "quote vs not"))
    # 8
    section("8. First-sight engagement ratios (contested-post proxy)",
            f"From raw_tweet.public_metrics at first sight. Terciles are cut once on all joined matured notes (no labels used): "
            f"reply_count/impressions cuts at {cuts['reply_ratio'][0]:.5f} and {cuts['reply_ratio'][1]:.5f}; "
            f"quote_count/impressions cuts at {cuts['quote_ratio'][0]:.6f} and {cuts['quote_ratio'][1]:.6f}.")
    o = ["low", "mid", "high"]
    w("reply_count / impression_count:\n"); w(table_exclusive(df, "f_reply_ratio", o)); w("")
    w(contrast_trend(df, "8 reply ratio", "f_reply_ratio", o, "trend across reply-ratio terciles"))
    w("\nquote_count / impression_count:\n"); w(table_exclusive(df, "f_quote_ratio", o)); w("")
    w(contrast_trend(df, "8 quote ratio", "f_quote_ratio", o, "trend across quote-ratio terciles"))
    # 9
    section("9. Language")
    w(table_exclusive(df, "f_lang", ["en", "other"])); w("")
    w(contrast_binary(F, "9 lang", F["f_lang"] == "en", F["f_lang"] == "other", "en vs other"))
    # 10
    section("10. Evaluation score (X evaluate_note; post-write, not a tweet-level feature; benchmark only)",
            "Missing is its own bucket. The missing bucket is almost entirely the last days before the maturity cutoff, so it is confounded with date. "
            "Every matured note ran under `eval_submit_threshold` = -3, so the low end is barely truncated.")
    o = ["<0", "0-0.5", "0.5-1", ">=1", "missing"]
    w(table_exclusive(df, "f_eval_score", o)); w("")
    w(contrast_trend(df, "10 eval score", "f_eval_score", o[:4], "trend across the four scored bands"))
    miss = df[df["eval_score"].isna()]
    w(f"\nMissing-score notes by submit date: {miss['when'].dt.date.value_counts().sort_index().to_dict()}")

    # ----- AUC comparator (same features, continuous form; not new cuts)
    w("\n## Univariate AUC per period (comparator to earlier work)\n")
    w("AUC for H vs everything else, using the raw continuous value of features already listed above. Sign is kept: below 0.5 means higher values go with fewer H. "
      "Intervals are Hanley-McNeil 95%. Earlier work: fetch-time predictors 0.55-0.60 temporal AUC, evaluation score about 0.67.\n")
    w("| feature (raw value) | A: AUC [95%] (n, H) | B: AUC [95%] (n, H) |\n|---|---|---|")
    for lab, col in [("earlier notes count", "n_before"), ("age at first sight (h)", "age_h"), ("velocity (impr/h)", "velocity"),
                     ("author followers", "author_followers"), ("reply/impression", "reply_ratio"), ("quote/impression", "quote_ratio"),
                     ("evaluation score (non-missing)", "eval_score")]:
        cells = []
        for p in ["A", "B"]:
            d = df[(df["period"] == p) & df[col].notna()]
            pos, neg = d.loc[d["H"] == 1, col].astype(float), d.loc[d["H"] == 0, col].astype(float)
            if len(pos) < 5 or len(neg) < 5:
                cells.append("n/a"); continue
            a = stats.mannwhitneyu(pos, neg).statistic / (len(pos) * len(neg))
            q1, q2 = a / (2 - a), 2 * a * a / (1 + a)
            se = np.sqrt((a * (1 - a) + (len(pos) - 1) * (q1 - a * a) + (len(neg) - 1) * (q2 - a * a)) / (len(pos) * len(neg)))
            cells.append(f"{a:.3f} [{a - 1.96 * se:.3f}, {a + 1.96 * se:.3f}] (n={len(d)}, H={len(pos)})")
        w(f"| {lab} | {cells[0]} | {cells[1]} |")
    cells = []
    for p in ["A", "B"]:
        d = df[(df["period"] == p) & df["eval_score"].notna() & (df["rated"] == 1)]
        pos, neg = d.loc[d["H"] == 1, "eval_score"], d.loc[d["NH"] == 1, "eval_score"]
        a = stats.mannwhitneyu(pos, neg).statistic / (len(pos) * len(neg))
        q1, q2 = a / (2 - a), 2 * a * a / (1 + a)
        se = np.sqrt((a * (1 - a) + (len(pos) - 1) * (q1 - a * a) + (len(neg) - 1) * (q2 - a * a)) / (len(pos) * len(neg)))
        cells.append(f"{a:.3f} [{a - 1.96 * se:.3f}, {a + 1.96 * se:.3f}] (H={len(pos)}, NH={len(neg)})")
    w(f"| evaluation score, H vs NH among rated notes only | {cells[0]} | {cells[1]} |")
    w("\nThe last row is a different question (given a note got rated, which way) and is shown because it is the only framing here that reproduces the earlier ~0.67, and only in period A.")

    # ----- post-hoc
    w("\n## POST-HOC (chosen after looking at the tables; hypothesis-generating only)\n")
    w("The NH column stood out in three tables, so NH rate was tested for those three contrasts only. These were picked because they looked large, which inflates them. "
      "There are 61 NH notes in total.\n")
    n_pre = len(RESULTS)
    for lab, a_, b_ in [("0 earlier notes vs 1+", df["n_before"] == 0, df["n_before"] >= 1),
                        ("no media vs any media", df["f_media"] == "none", df["f_media"].isin(["video", "photo"])),
                        ("quote tweet vs not", df["f_is_quote"] == "quote", df["f_is_quote"] == "not quote")]:
        for p in ["A", "B"]:
            d = df[df["period"] == p]
            ga, gb = d[a_.loc[d.index]], d[b_.loc[d.index]]
            x1, n1, x2, n2 = int(ga["NH"].sum()), len(ga), int(gb["NH"].sum()), len(gb)
            dd, lo, hi = newcombe(x1, n1, x2, n2)
            pv = stats.fisher_exact([[x1, n1 - x1], [x2, n2 - x2]])[1]
            w(f"- NH rate, {lab}, period {p}: {x1}/{n1} ({pct(x1 / n1)}) vs {x2}/{n2} ({pct(x2 / n2)}); difference {pp(dd)} [{pp(lo)}, {pp(hi)}], Fisher p={pv:.4f}")
    assert len(RESULTS) == n_pre  # post-hoc rows never enter the roll-up

    # ----- verdict roll-up
    w("\n## Verdict roll-up (all pre-declared contrasts)\n")
    nt = len(RESULTS)
    w(f"{nt} contrast-outcome pairs were screened ({nt // 2} contrasts x 2 outcomes). With this many, a few 'holds' are expected by chance even if nothing is real; treat a 'holds' as a candidate, not a finding.\n")
    w("| feature | contrast | outcome | A effect | B effect | pooled [95%] | verdict |\n|---|---|---|---|---|---|---|")
    for name, label, oname, verdict, per, pooled in RESULTS:
        unit = "/band" if "trend" in label else ""
        a = f"{pp(per['A']['d'], 2)}{unit} (p={per['A']['p']:.3f})" if per.get("A") else "n/a"
        b = f"{pp(per['B']['d'], 2)}{unit} (p={per['B']['p']:.3f})" if per.get("B") else "n/a"
        pl = f"{pp(pooled[0], 2)} [{pp(pooled[1], 2)}, {pp(pooled[2], 2)}]" if not np.isnan(pooled[0]) else "n/a"
        w(f"| {name} | {label} | {oname} | {a} | {b} | {pl} | {verdict} |")
    vc = Counter((o_, v) for _, _, o_, v, _, _ in RESULTS)
    w(f"\nCounts: {dict(sorted((f'{k[0]}: {k[1]}', v) for k, v in vc.items()))}")

    w("\n## Not screened\n")
    w("- Polarity / partisanship of the post or author: needs an LLM or X's rater-factor data. Not available, not invented.")
    w("- Anything about the note text itself (length, sources, tone) other than the evaluation score benchmark.")
    w("- A/B arm effects (`ab_test_picks`): pulled but not screened; arms changed over time and are a separate question.")
    w("- Multivariate models, interactions, and the 4-flag rule as a combined rule (its component flags appear in 4a, 5, 6, 7a).")
    w("- Refreshed engagement columns (impressions/likes/retweets/replies) were deliberately not pulled: they leak the future.")

    body = "\n".join(L) + "\n"
    out = HERE / "RESULTS.md"
    top = ""
    if out.exists() and MARKER in out.read_text():
        top = out.read_text().split(MARKER)[0]
    else:
        top = "# Outcome screen, 2026-09-18\n\n(top section not yet written)\n\n"
    out.write_text(top + MARKER + "\n\n" + body)
    print(f"wrote {out}  matured n={len(df)}  contrasts={nt}")


if __name__ == "__main__":
    main()
