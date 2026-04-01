"""Within-tweet paired comparison: CRH note vs NMR sibling notes.

For tweets with exactly 1 CRH note and 1+ NMR notes, compare lengths.
This controls for tweet-level confounds (topic, difficulty, virality).

Usage: uv run <script> [sample_size]
"""

import sys
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from tqdm import tqdm
from urlextract import URLExtract

DATA_DIR = "scripts_jim/cn_data"
OUT_DIR = "scripts_jim/2026_03_31_note_length_investigation"

_extractor = URLExtract()


def strip_links(text: str) -> str:
    if not isinstance(text, str):
        return ""
    for url in _extractor.gen_urls(text):
        text = text.replace(url, "")
    return " ".join(text.split())


def load_notes() -> pd.DataFrame:
    frames = []
    for i in range(2):
        path = f"{DATA_DIR}/notes-0000{i}.tsv"
        df = pd.read_csv(path, sep="\t", usecols=["noteId", "tweetId", "summary"])
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def load_status() -> pd.DataFrame:
    return pd.read_csv(
        f"{DATA_DIR}/noteStatusHistory-00000.tsv",
        sep="\t",
        usecols=["noteId", "currentStatus"],
    )


def main():
    sample_size = int(sys.argv[1]) if len(sys.argv) > 1 else None

    print("Loading data...")
    notes = load_notes()
    status = load_status()
    df = notes.merge(status, on="noteId", how="inner")
    print(f"  {len(df):,} notes with status")

    if sample_size:
        # Sample by tweet to keep sibling notes together
        tweet_ids = df["tweetId"].unique()
        rng = np.random.default_rng(42)
        sampled_tweets = rng.choice(tweet_ids, size=min(sample_size, len(tweet_ids)), replace=False)
        df = df[df["tweetId"].isin(sampled_tweets)]
        print(f"  Sampled {len(df):,} notes from {len(sampled_tweets):,} tweets")

    tqdm.pandas(desc="Stripping links")
    df["text"] = df["summary"].progress_apply(strip_links)
    df["length"] = df["text"].str.len()
    df = df[df["length"] > 0].copy()

    # Label statuses
    df["is_crh"] = df["currentStatus"] == "CURRENTLY_RATED_HELPFUL"
    df["is_nmr"] = df["currentStatus"] == "NEEDS_MORE_RATINGS"

    # Find tweets with at least 1 CRH and at least 1 NMR note
    tweet_has_crh = df.groupby("tweetId")["is_crh"].any()
    tweet_has_nmr = df.groupby("tweetId")["is_nmr"].any()
    eligible_tweets = tweet_has_crh[tweet_has_crh].index.intersection(
        tweet_has_nmr[tweet_has_nmr].index
    )
    df_eligible = df[df["tweetId"].isin(eligible_tweets) & (df["is_crh"] | df["is_nmr"])]
    print(f"\nTweets with >= 1 CRH + >= 1 NMR note: {len(eligible_tweets):,}")
    print(f"  CRH notes: {df_eligible['is_crh'].sum():,}")
    print(f"  NMR notes: {df_eligible['is_nmr'].sum():,}")

    crh_lengths = df_eligible.loc[df_eligible["is_crh"], "length"]
    nmr_lengths = df_eligible.loc[df_eligible["is_nmr"], "length"]
    print(f"\nLength stats:")
    print(f"  CRH: median={crh_lengths.median():.0f}, mean={crh_lengths.mean():.0f}")
    print(f"  NMR: median={nmr_lengths.median():.0f}, mean={nmr_lengths.mean():.0f}")

    # --- Exact pairs: tweets with exactly 1 CRH + exactly 1 NMR ---
    crh_per_tweet = df_eligible.groupby("tweetId")["is_crh"].sum()
    nmr_per_tweet = df_eligible.groupby("tweetId")["is_nmr"].sum()
    exact_pair_tweets = crh_per_tweet[(crh_per_tweet == 1)].index.intersection(
        nmr_per_tweet[(nmr_per_tweet == 1)].index
    )
    df_pairs = df_eligible[df_eligible["tweetId"].isin(exact_pair_tweets)]
    print(f"\nExact 1v1 pairs (1 CRH + 1 NMR): {len(exact_pair_tweets):,} tweets")

    crh_pair = df_pairs[df_pairs["is_crh"]].set_index("tweetId")["length"]
    nmr_pair = df_pairs[df_pairs["is_nmr"]].set_index("tweetId")["length"]
    common = crh_pair.index.intersection(nmr_pair.index)
    length_diff = crh_pair.loc[common] - nmr_pair.loc[common]  # positive = CRH longer

    crh_longer = (length_diff > 0).sum()
    nmr_longer = (length_diff < 0).sum()
    tied = (length_diff == 0).sum()
    print(f"  CRH note longer: {crh_longer:,} ({crh_longer / len(length_diff):.1%})")
    print(f"  NMR note longer: {nmr_longer:,} ({nmr_longer / len(length_diff):.1%})")
    print(f"  Same length: {tied:,} ({tied / len(length_diff):.1%})")
    print(f"  Mean length diff (CRH - NMR): {length_diff.mean():.1f} chars")
    print(f"  Median length diff: {length_diff.median():.1f} chars")

    # --- Within-tweet: CRH is longest note? ---
    longest_per_tweet = df_eligible.loc[
        df_eligible.groupby("tweetId")["length"].idxmax()
    ]
    longest_is_crh = longest_per_tweet["is_crh"].mean()
    print(f"\nAmong eligible tweets, longest note is CRH: {longest_is_crh:.1%}")

    # --- Plot ---
    fig, axes = plt.subplots(1, 3, figsize=(18, 5))
    fig.suptitle("Within-tweet paired comparison: CRH vs NMR sibling notes\n(links excluded from length)", fontsize=13)

    # Length distributions
    ax = axes[0]
    bins = np.arange(0, 320, 10)
    ax.hist(crh_lengths, bins=bins, alpha=0.5, label=f"CRH (n={len(crh_lengths):,})", density=True)
    ax.hist(nmr_lengths, bins=bins, alpha=0.5, label=f"NMR (n={len(nmr_lengths):,})", density=True)
    ax.set_xlabel("Note length (chars)")
    ax.set_ylabel("Density")
    ax.set_title("Length distribution")
    ax.legend()

    # Length difference in exact pairs
    ax = axes[1]
    ax.hist(length_diff, bins=80, alpha=0.7, color="steelblue")
    ax.axvline(0, color="red", linestyle="--", alpha=0.7)
    ax.axvline(length_diff.mean(), color="black", linestyle="-", alpha=0.7, label=f"mean={length_diff.mean():.0f}")
    ax.set_xlabel("Length diff (CRH - NMR, chars)")
    ax.set_ylabel("Count")
    ax.set_title(f"1v1 pairs: length difference (n={len(length_diff):,})")
    ax.legend()

    # Win rate by length difference bucket
    ax = axes[2]
    diff_bins = pd.cut(crh_pair.loc[common] - nmr_pair.loc[common], bins=20)
    # Instead: bin by absolute CRH length, show "CRH longer" rate
    crh_len_bins = pd.cut(crh_pair.loc[common], bins=np.arange(0, 320, 20))
    win_by_crh_len = pd.DataFrame({
        "crh_longer": length_diff > 0,
        "bin": crh_len_bins,
    }).groupby("bin", observed=True).agg(
        rate=("crh_longer", "mean"),
        count=("crh_longer", "size"),
    )
    mask = win_by_crh_len["count"] >= 20
    bin_mids = [interval.mid for interval in win_by_crh_len.index]
    ax.plot(
        [m for m, v in zip(bin_mids, mask) if v],
        win_by_crh_len.loc[mask, "rate"],
        "o-", markersize=4, color="green",
    )
    ax.axhline(0.5, color="gray", linestyle="--", alpha=0.5)
    ax.set_xlabel("CRH note length (chars)")
    ax.set_ylabel("P(CRH is longer)")
    ax.set_title("P(CRH note is longer) by CRH length")
    ax.set_ylim(0, 1)

    plt.tight_layout()
    out_path = f"{OUT_DIR}/paired_comparison.png"
    plt.savefig(out_path, dpi=150)
    print(f"\nSaved {out_path}")


if __name__ == "__main__":
    main()
