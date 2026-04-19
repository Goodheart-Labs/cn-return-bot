"""Sample a small video testset: 6 from first 67 ('yes'), 4 from last 33 ('no')."""
from pathlib import Path
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE = REPO_ROOT / "datasets" / "video_testset.csv"
DEST = REPO_ROOT / "datasets" / "video_testset_small.csv"

YES_COUNT = 6
NO_COUNT = 4
YES_END = 67
RANDOM_SEED = 42


def main() -> None:
    df = pd.read_csv(SOURCE)
    assert len(df) == 100, f"expected 100 rows, got {len(df)}"

    yes_rows = df.iloc[:YES_END]
    no_rows = df.iloc[YES_END:]
    assert (yes_rows["needs_note"] == "yes").all()
    assert (no_rows["needs_note"] == "no").all()

    yes_sample = yes_rows.sample(n=YES_COUNT, random_state=RANDOM_SEED)
    no_sample = no_rows.sample(n=NO_COUNT, random_state=RANDOM_SEED)

    small = pd.concat([yes_sample, no_sample]).sort_index()
    small.to_csv(DEST, index=False)
    print(f"Wrote {len(small)} rows to {DEST.relative_to(REPO_ROOT)}")
    print(small["needs_note"].value_counts().to_dict())


if __name__ == "__main__":
    main()
