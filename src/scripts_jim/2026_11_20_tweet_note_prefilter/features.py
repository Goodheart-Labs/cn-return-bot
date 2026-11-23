"""Free signals about a tweet, for the metadata model (GOO-835).

Everything here is known when the X run picks the tweet, so a filter could use
it at no cost: the feed tier, velocity and age, follower count, engagement
ratios, media flags, how the author's earlier tweets did, and how the most
similar earlier tweets did (see neighbours.py).
"""

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

DATA_DIR = Path("/home/jim/dev/data/goo-835")
TIER_RANK = {"small": 0, "large": 1, "xl": 2}
NEIGHBOURS_FOR_RATE = 10
# The neighbour rate is shrunk towards the overall rate as if it had this many
# extra neighbours at the overall rate, so a tweet with few neighbours is not
# judged on one or two of them.
NEIGHBOUR_PRIOR_WEIGHT = 2.0


def neighbour_features(df: pd.DataFrame) -> pd.DataFrame:
    """How the tweet's most similar earlier tweets turned out. See neighbours.py."""
    index = np.load(DATA_DIR / "neighbour_index.npy")[:, :NEIGHBOURS_FOR_RATE]
    similarity = np.load(DATA_DIR / "neighbour_similarity.npy")[:, :NEIGHBOURS_FOR_RATE]
    valid = index >= 0
    helpful = df["helpful"].to_numpy()[np.where(valid, index, 0)] & valid
    noted = (df["notes"].to_numpy() > 0)[np.where(valid, index, 0)] & valid
    overall = df["helpful"].mean()
    count = valid.sum(axis=1)
    return pd.DataFrame({
        "neighbour_helpful_rate": (helpful.sum(axis=1) + NEIGHBOUR_PRIOR_WEIGHT * overall) / (count + NEIGHBOUR_PRIOR_WEIGHT),
        "neighbour_noted_rate": (noted.sum(axis=1) + NEIGHBOUR_PRIOR_WEIGHT * 0.5) / (count + NEIGHBOUR_PRIOR_WEIGHT),
        "top_neighbour_similarity": similarity[:, 0],
        "top_neighbour_helpful": helpful[:, 0].astype(float),
    }, index=df.index)


def metadata_features(df: pd.DataFrame) -> pd.DataFrame:
    ranking = df["ranking_features"].apply(lambda r: r if isinstance(r, dict) else {})
    impressions = df["impressions"].astype(float).clip(lower=1)
    features = pd.DataFrame({
        "tier": df["feed_size"].map(TIER_RANK),
        "log_velocity": np.log10(ranking.apply(lambda r: r.get("velocityPerHour") or np.nan).astype(float).clip(lower=1)),
        "age_hours": ranking.apply(lambda r: r.get("ageHoursAtFetch") or np.nan).astype(float),
        "log_followers": np.log10(df["author_followers"].astype(float).clip(lower=1)),
        "log_impressions": np.log10(impressions),
        "like_ratio": df["likes"].astype(float) / impressions,
        "reply_ratio": df["replies"].astype(float) / impressions,
        "quote_ratio": df["quotes"].astype(float) / impressions,
        "retweet_ratio": df["retweets"].astype(float) / impressions,
        "bookmark_ratio": df["bookmarks"].astype(float) / impressions,
        "has_video": df["has_video"].astype(float),
        "has_photo": df["has_photo"].astype(float),
        "is_quote": df["referenced_tweets"].astype(str).str.contains("quoted").astype(float),
        "is_reply": df["referenced_tweets"].astype(str).str.contains("replied_to").astype(float),
        "text_length": df["text"].fillna("").str.len(),
        "hour_utc": df["first_seen_at"].dt.hour,
        "author_prior_tweets": df["author_prior_tweets"],
        "author_prior_helpful": df["author_prior_helpful"],
        "author_prior_noted": df["author_prior_noted"],
        "author_prior_helpful_rate": (df["author_prior_helpful"] + 0.1) / (df["author_prior_tweets"] + 1),
    })
    return pd.concat([features, neighbour_features(df)], axis=1)



def fit_metadata_model(features: pd.DataFrame, labels: pd.Series) -> HistGradientBoostingClassifier:
    model = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=80, l2_regularization=1.0, random_state=0)
    return model.fit(features, labels)
