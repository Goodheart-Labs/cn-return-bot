"""How long does it take one of our notes to get rated helpful?

Uses X's public `noteStatusHistory` dump (X's own timestamps, NOT our scraper —
so no scraper-cadence bias). For each of our notes whose first non-NMR status
was CURRENTLY_RATED_HELPFUL, time-to-helpful = firstNonNMRStatus - createdAt.

Dump is from ~May 21, which is fine: we want a maturation DISTRIBUTION over
notes that have had time to settle, not the latest cohort.

Out: percentiles + cumulative table + histogram PNG.
Run: uv run src/scripts_jim/2026_06_15_helpful_drop/time_to_helpful.py
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent
DUMP = HERE.parents[1] / "production" / "cn_data" / "noteStatusHistory-00000.tsv"

OUR_AUTHOR_ID = "813EB394B10809EBA8D09BCFA8E2E1C25A2DA0085186867F9E9C00696951C447"
HELPFUL = "CURRENTLY_RATED_HELPFUL"
MS_PER_HOUR = 3_600_000

# Column indices (see header).
COL_AUTHOR = 1
COL_CREATED_MS = 2
COL_FIRST_NONMR_MS = 3
COL_FIRST_NONMR_STATUS = 4
COL_CURRENT_STATUS = 6


def main() -> None:
    hours = []            # NMR -> CRH directly: exact time to first-helpful
    nh_first_now_crh = 0  # detoured through NH, now helpful (not in `hours`)
    with DUMP.open() as f:
        f.readline()
        for line in f:
            c = line.rstrip("\n").split("\t")
            if c[COL_AUTHOR] != OUR_AUTHOR_ID:
                continue
            if c[COL_FIRST_NONMR_STATUS] == HELPFUL:
                created = int(c[COL_CREATED_MS])
                first = int(c[COL_FIRST_NONMR_MS])
                dh = (first - created) / MS_PER_HOUR
                if dh >= 0:
                    hours.append(dh)
            elif c[COL_CURRENT_STATUS] == HELPFUL:
                nh_first_now_crh += 1

    hours.sort()
    n = len(hours)
    print(f"Dump: {DUMP.name}")
    print(f"Notes NMR->helpful (direct, exact timing): {n}")
    print(f"Notes that detoured via NH then became helpful (excluded): {nh_first_now_crh}\n")

    def pct(p):
        return hours[min(n - 1, int(p / 100 * n))]

    print("=== TIME FROM SUBMISSION TO FIRST RATED HELPFUL ===")
    for p in (10, 25, 50, 75, 90, 95):
        h = pct(p)
        print(f"  p{p:<3} = {h:6.1f} h  ({h/24:4.1f} d)")

    print("\n=== CUMULATIVE: share rated helpful within ... ===")
    for thr in (6, 12, 24, 36, 48, 72, 96, 120, 168):
        share = sum(1 for x in hours if x <= thr) / n
        label = f"{thr}h" if thr < 48 else f"{thr}h ({thr//24}d)"
        print(f"  within {label:<11}: {share:5.1%}")

    # --- histogram ---
    BIN_H = 6
    MAX_H = 168  # 1 week; everything beyond piles into the last bin
    bins = list(range(0, MAX_H + BIN_H, BIN_H))
    clipped = [min(x, MAX_H - 0.001) for x in hours]
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.hist(clipped, bins=bins, color="#2b8cbe", edgecolor="white")
    median = pct(50)
    ax.axvline(median, color="crimson", linestyle="--", linewidth=2,
               label=f"median {median:.0f}h ({median/24:.1f}d)")
    ax.axvline(24, color="green", linestyle=":", linewidth=2, label="24h")
    ax.set_xlabel("hours from submission to first rated HELPFUL (last bin = 168h+)")
    ax.set_ylabel("number of notes")
    ax.set_title(f"Time for our notes to get rated helpful (n={n}, X public dump ~May 21)")
    ax.set_xticks(range(0, MAX_H + 1, 24))
    ax.legend()
    fig.tight_layout()
    out = HERE / "time_to_helpful.png"
    fig.savefig(out, dpi=120)
    print(f"\nHistogram -> {out}")


if __name__ == "__main__":
    main()
