#!/usr/bin/env python3
"""Visualize the tagged video dataset."""

import csv
from collections import Counter
from pathlib import Path

import matplotlib.pyplot as plt

SCRIPT_DIR = Path(__file__).parent
TAGGED_CSV = SCRIPT_DIR / "video_dataset_tagged.csv"
OUTPUT_DIR = SCRIPT_DIR / "plots"


def load_data():
    with open(TAGGED_CSV) as f:
        return list(csv.DictReader(f))


FILTERED_TAGS = {"misinformation", "fake_news"}


def split_tags(row):
    tags_str = row.get("tags", "")
    if not tags_str:
        return []
    return [t.strip() for t in tags_str.split("|") if t.strip() and t.strip() not in FILTERED_TAGS]


def plot_tiktok_distribution(noteworthy, not_noteworthy):
    """Histogram of TikTok-likeness scores for both groups."""
    fig, ax = plt.subplots(figsize=(8, 5))

    scores_nw = [int(r["tiktok_likeness"]) for r in noteworthy if r.get("tiktok_likeness")]
    scores_nnw = [int(r["tiktok_likeness"]) for r in not_noteworthy if r.get("tiktok_likeness")]

    bins = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]
    ax.hist(
        [scores_nw, scores_nnw],
        bins=bins,
        label=["Noteworthy", "Not noteworthy"],
        edgecolor="black",
        alpha=0.7,
    )
    ax.set_xlabel("TikTok-likeness score")
    ax.set_ylabel("Count")
    ax.set_title("TikTok-Likeness Distribution")
    ax.set_xticks([1, 2, 3, 4, 5])
    ax.legend()

    fig.tight_layout()
    fig.savefig(OUTPUT_DIR / "tiktok_likeness_distribution.png", dpi=150)
    print(f"Saved tiktok_likeness_distribution.png")
    plt.close(fig)


def plot_single_tag_bar(rows, label, filename, top_n=15):
    """Bar chart showing % of videos with each tag for one group."""
    tag_counter = Counter()
    for r in rows:
        tag_counter.update(split_tags(r))

    top = tag_counter.most_common(top_n)
    if not top:
        return

    n = len(rows)
    tags = [t for t, _ in top]
    pcts = [c / n * 100 for _, c in top]

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.bar(range(len(tags)), pcts, edgecolor="black", alpha=0.7)
    ax.set_xticks(range(len(tags)))
    ax.set_xticklabels(tags, rotation=45, ha="right", fontsize=9)
    ax.set_ylabel("% of videos")
    ax.set_title(f"{label} — Top {top_n} Tags (n={n})")

    fig.tight_layout()
    fig.savefig(OUTPUT_DIR / filename, dpi=150)
    print(f"Saved {filename}")
    plt.close(fig)



def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    rows = load_data()
    print(f"Loaded {len(rows)} rows")

    noteworthy = [r for r in rows if r["needs_note"] == "yes"]
    not_noteworthy = [r for r in rows if r["needs_note"] == "no"]
    print(f"  Noteworthy: {len(noteworthy)}, Not noteworthy: {len(not_noteworthy)}")

    plot_single_tag_bar(noteworthy, "Noteworthy", "tags_noteworthy.png")
    plot_single_tag_bar(not_noteworthy, "Not Noteworthy", "tags_not_noteworthy.png")
    plot_tiktok_distribution(noteworthy, not_noteworthy)

    print(f"\nAll plots saved to {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
