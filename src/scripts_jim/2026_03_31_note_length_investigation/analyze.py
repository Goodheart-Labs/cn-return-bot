"""Investigate how note length affects resolve rate and helpful rate.

Usage: uv run <script> [sample_size]
  sample_size: number of notes to process (default: all)
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
        df = pd.read_csv(path, sep="\t", usecols=["noteId", "summary"])
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def load_status() -> pd.DataFrame:
    return pd.read_csv(
        f"{DATA_DIR}/noteStatusHistory-00000.tsv",
        sep="\t",
        usecols=["noteId", "currentStatus"],
    )


def bucket_and_aggregate(df: pd.DataFrame, bin_size: int) -> pd.DataFrame:
    max_len = int(df["length"].max()) + bin_size
    bins = list(range(0, max_len, bin_size))
    df = df.copy()
    df["length_bin"] = pd.cut(df["length"], bins=bins)
    grouped = df.groupby("length_bin", observed=True).agg(
        count=("resolved", "size"),
        resolved=("resolved", "sum"),
        helpful=("helpful", "sum"),
    )
    grouped["resolve_rate"] = grouped["resolved"] / grouped["count"]
    grouped["helpful_rate_of_resolved"] = grouped["helpful"] / grouped["resolved"]
    grouped["helpful_rate_of_all"] = grouped["helpful"] / grouped["count"]
    grouped["bin_mid"] = [interval.mid for interval in grouped.index]
    return grouped


def plot_rates(grouped: pd.DataFrame, df: pd.DataFrame, min_n: int, title_suffix: str, filename: str):
    fig, axes = plt.subplots(1, 3, figsize=(18, 5))
    fig.suptitle(f"Note Length vs Outcomes — {title_suffix}\n(URLs excluded from length)", fontsize=13)

    mask = grouped["count"] >= min_n

    # Volume
    ax = axes[0]
    ax.bar(grouped["bin_mid"], grouped["count"], width=grouped["bin_mid"].diff().median() * 0.8 if len(grouped) > 1 else 10, alpha=0.7)
    ax.set_xlabel("Note length (chars)")
    ax.set_ylabel("Count")
    ax.set_title("Volume")

    # Resolve rate
    ax = axes[1]
    ax.plot(grouped.loc[mask, "bin_mid"], grouped.loc[mask, "resolve_rate"], "o-", markersize=3)
    ax.set_xlabel("Note length (chars)")
    ax.set_ylabel("Resolve rate")
    ax.set_title("Resolve rate")
    ax.set_ylim(0, min(0.35, grouped.loc[mask, "resolve_rate"].max() * 1.5))
    ax.axhline(df["resolved"].mean(), color="gray", linestyle="--", alpha=0.5, label=f'overall ({df["resolved"].mean():.1%})')
    ax.legend()

    # Helpful rate of resolved
    ax = axes[2]
    ax.plot(grouped.loc[mask, "bin_mid"], grouped.loc[mask, "helpful_rate_of_resolved"], "o-", markersize=3, color="green")
    ax.set_xlabel("Note length (chars)")
    ax.set_ylabel("Helpful rate (of resolved)")
    ax.set_title("Helpful rate (of resolved)")
    resolved_mask = df["resolved"]
    overall_helpful = df.loc[resolved_mask, "helpful"].mean()
    ax.axhline(overall_helpful, color="gray", linestyle="--", alpha=0.5, label=f"overall ({overall_helpful:.1%})")
    ax.set_ylim(0, 1)
    ax.legend()

    plt.tight_layout()
    plt.savefig(f"{OUT_DIR}/{filename}", dpi=150)
    print(f"Saved {OUT_DIR}/{filename}")
    plt.close()


def main():
    sample_size = int(sys.argv[1]) if len(sys.argv) > 1 else None

    print("Loading notes...")
    notes = load_notes()
    print(f"  {len(notes):,} notes")

    print("Loading status history...")
    status = load_status()
    print(f"  {len(status):,} status rows")

    df = notes.merge(status, on="noteId", how="inner")
    print(f"  {len(df):,} joined rows")

    if sample_size:
        df = df.sample(n=min(sample_size, len(df)), random_state=42)
        print(f"  Sampled {len(df):,} rows")

    tqdm.pandas(desc="Stripping links")
    df["text"] = df["summary"].progress_apply(strip_links)
    df["length"] = df["text"].str.len()

    df["resolved"] = df["currentStatus"].isin(
        ["CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL"]
    )
    df["helpful"] = df["currentStatus"] == "CURRENTLY_RATED_HELPFUL"

    df = df[df["length"] > 0].copy()

    print(f"\nLength distribution:")
    for p in [5, 25, 50, 75, 90, 95, 99]:
        print(f"  p{p}: {df['length'].quantile(p / 100):.0f}")

    print(f"\nOverall ({len(df):,} notes):")
    print(f"  Resolve rate: {df['resolved'].mean():.1%}")
    print(f"  Helpful rate (of resolved): {df.loc[df['resolved'], 'helpful'].mean():.1%}")

    # Fine bins (20 chars) — main range
    print("\n--- 20-char bins (0-300) ---")
    df_main = df[df["length"] <= 300]
    grouped_fine = bucket_and_aggregate(df_main, 20)
    print(grouped_fine[["count", "resolve_rate", "helpful_rate_of_resolved"]].to_string())
    plot_rates(grouped_fine, df_main, 200, "20-char bins, 0–300 chars", "fine_bins.png")

    # Full range with larger bins
    print("\n--- 50-char bins (full range) ---")
    grouped_full = bucket_and_aggregate(df, 50)
    print(grouped_full[["count", "resolve_rate", "helpful_rate_of_resolved"]].to_string())
    plot_rates(grouped_full, df, 50, "50-char bins, full range", "full_range.png")


if __name__ == "__main__":
    main()
