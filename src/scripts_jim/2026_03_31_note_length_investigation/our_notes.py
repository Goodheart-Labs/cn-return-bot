"""Note length vs outcome for our bot-written notes (prod Supabase).

Usage: uv run <script>
"""

import os
from pathlib import Path

import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm
from urlextract import URLExtract

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

OUT_DIR = "scripts_jim/2026_03_31_note_length_investigation"

_extractor = URLExtract()


def strip_links(text: str) -> str:
    if not isinstance(text, str):
        return ""
    for url in _extractor.gen_urls(text):
        text = text.replace(url, "")
    return " ".join(text.split())


def fetch_all(sb, table, select):
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        resp = sb.table(table).select(select).range(offset, offset + page_size - 1).execute()
        all_rows.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size
    return all_rows


def effective_status(row):
    s = ""
    for col in ["locked_status", "most_recent_non_nmr_status", "first_non_nmr_status", "cn_status"]:
        v = row.get(col)
        if isinstance(v, str) and v:
            s = v
            break
    s = s.upper()
    if "NOT_HELPFUL" in s or "UNHELPFUL" in s:
        return "CRNH"
    if "HELPFUL" in s:
        return "CRH"
    return "NMR"


def main():
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

    print("Fetching canonical_note_information...")
    rows = fetch_all(
        sb,
        "canonical_note_information",
        "note_id, note_text, cn_status, locked_status, first_non_nmr_status, most_recent_non_nmr_status, data_tier",
    )
    df = pd.DataFrame(rows)
    print(f"  {len(df):,} notes")

    df = df[df["data_tier"] != "junk"].copy()
    print(f"  {len(df):,} after removing junk tier")

    df["status"] = df.apply(effective_status, axis=1)

    tqdm.pandas(desc="Stripping links")
    df["text"] = df["note_text"].progress_apply(strip_links)
    df["length"] = df["text"].str.len()
    df = df[df["length"] > 0].copy()

    df["resolved"] = df["status"].isin(["CRH", "CRNH"])
    df["helpful"] = df["status"] == "CRH"

    print(f"\nStatus distribution:")
    print(df["status"].value_counts().to_string())

    print(f"\nLength distribution:")
    for p in [5, 25, 50, 75, 90, 95, 99]:
        print(f"  p{p}: {df['length'].quantile(p / 100):.0f}")

    print(f"\nOverall ({len(df):,} notes):")
    print(f"  Resolve rate: {df['resolved'].mean():.1%}")
    resolved = df[df["resolved"]]
    print(f"  Helpful rate (of resolved): {resolved['helpful'].mean():.1%}")

    # Bin by length (20 char bins)
    bin_size = 20
    max_len = int(df["length"].quantile(0.99)) + bin_size
    bins = list(range(0, max_len, bin_size))
    df["length_bin"] = pd.cut(df["length"], bins=bins)

    grouped = df.groupby("length_bin", observed=True).agg(
        count=("resolved", "size"),
        resolved=("resolved", "sum"),
        helpful=("helpful", "sum"),
    )
    grouped["resolve_rate"] = grouped["resolved"] / grouped["count"]
    grouped["helpful_rate_of_resolved"] = grouped["helpful"] / grouped["resolved"]
    grouped["bin_mid"] = [interval.mid for interval in grouped.index]

    print(f"\nBy length bucket ({bin_size}-char bins):")
    print(grouped[["count", "resolve_rate", "helpful_rate_of_resolved"]].to_string())

    # Plot
    fig, axes = plt.subplots(1, 3, figsize=(18, 5))
    fig.suptitle("Our Bot Notes: Length vs Outcomes (links excluded)", fontsize=13)
    min_n = 10

    mask = grouped["count"] >= min_n

    ax = axes[0]
    ax.bar(grouped["bin_mid"], grouped["count"], width=bin_size * 0.8, alpha=0.7)
    ax.set_xlabel("Note length (chars)")
    ax.set_ylabel("Count")
    ax.set_title("Volume")

    ax = axes[1]
    ax.plot(grouped.loc[mask, "bin_mid"], grouped.loc[mask, "resolve_rate"], "o-", markersize=4)
    ax.set_xlabel("Note length (chars)")
    ax.set_ylabel("Resolve rate")
    ax.set_title("Resolve rate")
    ax.axhline(df["resolved"].mean(), color="gray", linestyle="--", alpha=0.5, label=f'overall ({df["resolved"].mean():.1%})')
    ax.legend()

    ax = axes[2]
    ax.plot(grouped.loc[mask, "bin_mid"], grouped.loc[mask, "helpful_rate_of_resolved"], "o-", markersize=4, color="green")
    ax.set_xlabel("Note length (chars)")
    ax.set_ylabel("Helpful rate (of resolved)")
    ax.set_title("Helpful rate (of resolved)")
    ax.axhline(resolved["helpful"].mean(), color="gray", linestyle="--", alpha=0.5, label=f'overall ({resolved["helpful"].mean():.1%})')
    ax.set_ylim(0, 1)
    ax.legend()

    plt.tight_layout()
    out_path = f"{OUT_DIR}/our_notes.png"
    plt.savefig(out_path, dpi=150)
    print(f"\nSaved {out_path}")


if __name__ == "__main__":
    main()
