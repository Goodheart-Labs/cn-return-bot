"""Find each tweet's most similar earlier tweets (GOO-835).

For every tweet we keep the 20 tweets with the closest embeddings among those
we saw at least 3 days before it. A filter running in production at that moment
could have known how those earlier tweets turned out, so this is the "similar
tweets with notes on them" lookup Jim suggested, without peeking at the future.

Run from the worktree root:
  uv run --with pandas --with pyarrow src/scripts_jim/2026_11_20_tweet_note_prefilter/neighbours.py
"""

from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path("/home/jim/dev/data/goo-835")
NEIGHBOURS = 20
LABEL_LAG = pd.Timedelta(days=3)
CHUNK = 1000


def main() -> None:
    df = pd.read_parquet(DATA_DIR / "dataset.parquet", columns=["tweet_id", "first_seen_at", "helpful"])
    ids = pd.read_parquet(DATA_DIR / "embeddings_ids.parquet")
    assert (ids["tweet_id"].to_numpy() == df["tweet_id"].to_numpy()).all()
    vectors = np.load(DATA_DIR / "embeddings.npy")
    seen = df["first_seen_at"].dt.tz_convert(None).to_numpy()
    neighbour_index = np.full((len(df), NEIGHBOURS), -1, dtype=np.int32)
    neighbour_similarity = np.zeros((len(df), NEIGHBOURS), dtype=np.float32)
    for start in range(0, len(df), CHUNK):
        stop = min(start + CHUNK, len(df))
        similarity = vectors[start:stop] @ vectors.T
        too_recent = seen[None, :] > (seen[start:stop, None] - LABEL_LAG.to_timedelta64())
        similarity[too_recent] = -np.inf
        top = np.argpartition(-similarity, NEIGHBOURS, axis=1)[:, :NEIGHBOURS]
        top_similarity = np.take_along_axis(similarity, top, axis=1)
        order = np.argsort(-top_similarity, axis=1)
        top = np.take_along_axis(top, order, axis=1)
        top_similarity = np.take_along_axis(top_similarity, order, axis=1)
        valid = np.isfinite(top_similarity)
        neighbour_index[start:stop] = np.where(valid, top, -1)
        neighbour_similarity[start:stop] = np.where(valid, top_similarity, 0)
    np.save(DATA_DIR / "neighbour_index.npy", neighbour_index)
    np.save(DATA_DIR / "neighbour_similarity.npy", neighbour_similarity)
    print("tweets without any earlier neighbour:", int((neighbour_index[:, 0] < 0).sum()))


main()
