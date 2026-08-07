"""
Map the (number of ratings, helpful share) plane to P(note escapes NEEDS_MORE_RATINGS).

Each note contributes its latest public-dump rating counts and its current CN status.
The plane is binned; each bin is drawn as one marker: color = share of notes in the
bin that reached a terminal status, area = how many notes landed in the bin.
"""
import matplotlib.pyplot as plt
import numpy as np

import ratings_model as rm

SIZE_LEGEND_COUNTS = (10, 50, 200)


def plot_probability_map(ax, bins: list[dict]):
    return ax.scatter([b["x"] for b in bins], [b["y"] for b in bins],
                      s=[rm.marker_area(b["count"]) for b in bins], c=[b["rate"] for b in bins],
                      cmap=rm.SEQ, vmin=0, vmax=1, edgecolors="white", linewidths=1.4, zorder=3)


def plot_raw_notes(ax, notes: list[dict]) -> None:
    for status in ("NEEDS_MORE_RATINGS", rm.NOT_HELPFUL, rm.HELPFUL):
        subset = [n for n in notes if n["status"] == status]
        label = status.replace("CURRENTLY_RATED_", "").replace("_", " ").title()
        ax.scatter([n["ratings"] for n in subset], [n["helpful_share"] for n in subset],
                   s=12, c=rm.STATUS_COLOR[status], alpha=0.55, linewidths=0,
                   label=f"{label} ({len(subset):,})")


def main() -> None:
    notes = rm.load_notes()
    bins = rm.bin_by_plane(notes, "decided")
    fig, (ax_map, ax_raw) = plt.subplots(1, 2, figsize=(15, 7), facecolor="white", sharey=True)

    scatter = plot_probability_map(ax_map, bins)
    rm.style_ratings_axis(ax_map, "Ratings on the note (helpful + somewhat + not helpful)")
    rm.percent_axis(ax_map, "y", "Helpful share — helpful / (helpful + not helpful)")
    ax_map.set_ylim(-0.06, 1.06)
    rm.style_axes(ax_map, "Where a note stops needing more ratings",
                  f"colour = share of the bin's notes that reached a verdict · bins with ≥{rm.MIN_NOTES_PER_BIN} notes")
    rm.colorbar(fig, scatter, ax_map, "P(rated helpful or not helpful — no longer NEEDS_MORE_RATINGS)",
                horizontal=True)

    for count in SIZE_LEGEND_COUNTS:
        ax_map.scatter([], [], s=rm.marker_area(count), c="#d5d4d0", edgecolors="white",
                       linewidths=1.4, label=f"{count} notes")
    ax_map.legend(frameon=False, fontsize=8, loc="center right", labelcolor=rm.INK_MUTED,
                  labelspacing=1.1, borderpad=0.2, handletextpad=1.0, title="bin size",
                  title_fontproperties={"size": 8})

    plot_raw_notes(ax_raw, notes)
    rm.style_ratings_axis(ax_raw, "Ratings on the note (helpful + somewhat + not helpful)")
    ax_raw.set_ylim(-0.06, 1.06)
    rm.style_axes(ax_raw, "The underlying notes",
                  f"one dot per note · {len(notes):,} notes · latest public dump")
    ax_raw.legend(frameon=False, fontsize=8.5, loc="upper center", bbox_to_anchor=(0.5, -0.11),
                  ncol=3, labelcolor=rm.INK_MUTED, markerscale=1.8, handletextpad=0.3)

    fig.tight_layout()
    fig.savefig(rm.HERE / "rating_status_map.png", dpi=160, facecolor="white")
    print("wrote rating_status_map.png")

    print(f"\n{'ratings':>14}  {'helpful share':>14}  {'notes':>6}  {'P(decided)':>10}")
    for note_bin in sorted(bins, key=lambda b: (b["x"], b["y"])):
        print(f"{note_bin['x']:14.0f}  {note_bin['y']:14.2f}  {note_bin['count']:6d}  {note_bin['rate']:10.1%}")


if __name__ == "__main__":
    main()
