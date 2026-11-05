"""Did AI note writers make Community Notes appear faster? (GOO-723)

Reads the public Community Notes dump (notes + noteStatusHistory) and answers:
  1. By month of tweet creation: how many hours pass between a tweet being
     posted and its first note becoming "Currently Rated Helpful" (CRH)?
  2. What share of notes, and of first helpful notes, come from AI writers?
  3. Per AI writer: how fast are its helpful notes, and does it beat the
     human helpful note when both exist on the same tweet?

Only notes that call the tweet misleading count, because "not misleading"
notes are never shown.

Run from the worktree root:
  uv run --with pandas src/scripts_jim/2026_11_05_ai_writer_note_speed/analyze.py
"""

import csv
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parents[2]
DATA_DIR = PROJECT_ROOT / "src" / "scripts_jim" / "cn_data"
AI_AUTHOR_IDS_FILE = PROJECT_ROOT / "datasets" / "big_eval" / "ai_author_ids.txt"
RESULTS_DIR = HERE / "results"
# Reading the 2.5 GB of TSVs takes minutes, so the joined table is cached here.
JOINED_CACHE = RESULTS_DIR / "notes_with_status.pkl"

HELPFUL = "CURRENTLY_RATED_HELPFUL"
MISLEADING = "MISINFORMED_OR_POTENTIALLY_MISLEADING"
TWITTER_EPOCH_MILLIS = 1288834974657
SNOWFLAKE_TIMESTAMP_SHIFT = 22
MILLIS_PER_HOUR = 3_600_000
AI_API_LAUNCH = pd.Timestamp("2025-09-02", tz="UTC")
FIRST_COHORT_MONTH = "2024-07"
# A tweet counts only if its first helpful note came within this window. The
# same window for every month keeps recent months comparable to old ones,
# whose slow notes have had much longer to become helpful.
MAX_HOURS_TO_HELPFUL = 14 * 24
DUMP_DATE = pd.Timestamp("2026-11-05", tz="UTC")
WRITER_AI_API = "ai_api"
WRITER_COLLABORATIVE = "collaborative"
WRITER_HUMAN = "human"
# By April 2026 the API writers were past their ramp-up, so the comparison of
# writer types starts there.
WRITER_TYPE_COMPARISON_START = pd.Timestamp("2026-04-01", tz="UTC")

csv.field_size_limit(sys.maxsize)


def load_ai_author_ids() -> set[str]:
    return {line.strip() for line in AI_AUTHOR_IDS_FILE.read_text().splitlines() if line.strip()}


def read_tsv_columns(path: Path, columns: list[str]) -> pd.DataFrame:
    rows = []
    with path.open(newline="") as file:
        for row in csv.DictReader(file, delimiter="\t"):
            rows.append([row[column] for column in columns])
    return pd.DataFrame(rows, columns=columns)


def load_notes() -> pd.DataFrame:
    columns = ["noteId", "noteAuthorParticipantId", "createdAtMillis", "tweetId", "classification", "isCollaborativeNote"]
    parts = [read_tsv_columns(path, columns) for path in sorted(DATA_DIR.glob("notes-*.tsv"))]
    notes = pd.concat(parts, ignore_index=True)
    notes["createdAtMillis"] = notes["createdAtMillis"].astype("int64")
    notes["tweetId"] = notes["tweetId"].astype("int64")
    return notes


def first_helpful_millis(status: pd.DataFrame) -> pd.Series:
    """The moment a note first became helpful. Most helpful notes reach CRH as
    their first decided status. For the rest, the time of the current status is
    the best timestamp the dump offers."""
    first_decision_helpful = status["firstNonNMRStatus"] == HELPFUL
    currently_helpful = status["currentStatus"] == HELPFUL
    first = pd.to_numeric(status["timestampMillisOfFirstNonNMRStatus"], errors="coerce")
    current = pd.to_numeric(status["timestampMillisOfCurrentStatus"], errors="coerce")
    return first.where(first_decision_helpful, current.where(currently_helpful))


def load_status() -> pd.DataFrame:
    columns = ["noteId", "firstNonNMRStatus", "timestampMillisOfFirstNonNMRStatus", "currentStatus", "timestampMillisOfCurrentStatus"]
    status = read_tsv_columns(DATA_DIR / "noteStatusHistory-00000.tsv", columns)
    status["helpfulAtMillis"] = first_helpful_millis(status)
    return status[["noteId", "currentStatus", "helpfulAtMillis"]]


def tweet_created_millis(tweet_ids: pd.Series) -> pd.Series:
    return tweet_ids // (1 << SNOWFLAKE_TIMESTAMP_SHIFT) + TWITTER_EPOCH_MILLIS


def load_notes_with_status() -> pd.DataFrame:
    if JOINED_CACHE.exists():
        return pd.read_pickle(JOINED_CACHE)
    notes = load_notes().merge(load_status(), on="noteId", how="left")
    notes.to_pickle(JOINED_CACHE)
    return notes


def build_misleading_notes(ai_author_ids: set[str]) -> pd.DataFrame:
    notes = load_notes_with_status()
    notes = notes[notes["classification"] == MISLEADING].copy()
    notes["isAi"] = notes["noteAuthorParticipantId"].isin(ai_author_ids)
    notes["isCollaborative"] = notes["isCollaborativeNote"] == "1"
    # Collaborative notes are X's own AI drafts that humans refine. They are a
    # separate kind of AI note from the API writers in the author id list.
    notes["writerType"] = WRITER_HUMAN
    notes.loc[notes["isCollaborative"], "writerType"] = WRITER_COLLABORATIVE
    notes.loc[notes["isAi"], "writerType"] = WRITER_AI_API
    notes["tweetCreatedMillis"] = tweet_created_millis(notes["tweetId"])
    notes["hoursToNote"] = (notes["createdAtMillis"] - notes["tweetCreatedMillis"]) / MILLIS_PER_HOUR
    notes["hoursToHelpful"] = (notes["helpfulAtMillis"] - notes["tweetCreatedMillis"]) / MILLIS_PER_HOUR
    notes["noteMonth"] = pd.to_datetime(notes["createdAtMillis"], unit="ms", utc=True).dt.strftime("%Y-%m")
    notes["tweetMonth"] = pd.to_datetime(notes["tweetCreatedMillis"], unit="ms", utc=True).dt.strftime("%Y-%m")
    return notes


def first_helpful_note_per_tweet(notes: pd.DataFrame) -> pd.DataFrame:
    helpful = notes[notes["hoursToHelpful"].between(0, MAX_HOURS_TO_HELPFUL)]
    return helpful.sort_values("helpfulAtMillis").drop_duplicates("tweetId", keep="first")


def complete_cohort_months(months: pd.Series) -> pd.Series:
    """Drops cohorts whose tweets have not all had the full window yet."""
    last_complete_tweet = DUMP_DATE - pd.Timedelta(hours=MAX_HOURS_TO_HELPFUL)
    return (months >= FIRST_COHORT_MONTH) & (months < last_complete_tweet.strftime("%Y-%m"))


def monthly_speed(first_helpful: pd.DataFrame) -> pd.DataFrame:
    cohort = first_helpful[complete_cohort_months(first_helpful["tweetMonth"])]
    grouped = cohort.groupby("tweetMonth")
    return pd.DataFrame({
        "tweets_with_helpful_note": grouped.size(),
        "median_hours_to_helpful": grouped["hoursToHelpful"].median().round(1),
        "p25_hours": grouped["hoursToHelpful"].quantile(0.25).round(1),
        "p75_hours": grouped["hoursToHelpful"].quantile(0.75).round(1),
        "share_within_6h": grouped["hoursToHelpful"].apply(lambda hours: (hours <= 6).mean()).round(3),
        "share_first_by_ai_api": grouped["isAi"].mean().round(3),
        "share_first_collaborative": grouped["isCollaborative"].mean().round(3),
        **{
            f"median_hours_{writer_type}_first": cohort[cohort["writerType"] == writer_type].groupby("tweetMonth")["hoursToHelpful"].median().round(1)
            for writer_type in (WRITER_AI_API, WRITER_COLLABORATIVE, WRITER_HUMAN)
        },
    })


def monthly_ai_share(notes: pd.DataFrame) -> pd.DataFrame:
    recent = notes[notes["noteMonth"] >= FIRST_COHORT_MONTH]
    grouped = recent.groupby("noteMonth")
    helpful = recent[recent["currentStatus"] == HELPFUL].groupby("noteMonth")
    return pd.DataFrame({
        "misleading_notes": grouped.size(),
        "share_by_ai": grouped["isAi"].mean().round(3),
        "share_collaborative": grouped["isCollaborative"].mean().round(3),
        "helpful_notes": helpful.size(),
        "share_of_helpful_by_ai": helpful["isAi"].mean().round(3),
        "share_of_helpful_collaborative": helpful["isCollaborative"].mean().round(3),
    })


def head_to_head(writer_helpful: pd.DataFrame, human_first: pd.DataFrame) -> dict:
    """Compares a writer's helpful note with the first human helpful note on the same tweet."""
    pairs = writer_helpful.merge(human_first, on="tweetId", suffixes=("", "_human"))
    lead_hours = pairs["hoursToHelpful_human"] - pairs["hoursToHelpful"]
    return {
        "tweets_with_human_helpful_too": len(pairs),
        "share_writer_helpful_first": round((lead_hours > 0).mean(), 3) if len(pairs) else None,
        "median_lead_hours_vs_human": round(lead_hours.median(), 1) if len(pairs) else None,
    }


def per_writer(notes: pd.DataFrame, first_helpful: pd.DataFrame) -> pd.DataFrame:
    post_launch = notes[pd.to_datetime(notes["createdAtMillis"], unit="ms", utc=True) >= AI_API_LAUNCH]
    human_helpful = post_launch[(post_launch["writerType"] == WRITER_HUMAN) & post_launch["hoursToHelpful"].between(0, MAX_HOURS_TO_HELPFUL)]
    human_first = human_helpful.sort_values("helpfulAtMillis").drop_duplicates("tweetId")[["tweetId", "hoursToHelpful"]]
    first_note_ids = set(first_helpful["noteId"])
    rows = []
    for writer_id, writer_notes in post_launch[post_launch["isAi"]].groupby("noteAuthorParticipantId"):
        writer_helpful = writer_notes[writer_notes["hoursToHelpful"].between(0, MAX_HOURS_TO_HELPFUL)]
        rows.append({
            "writer": writer_id[:8],
            "misleading_notes": len(writer_notes),
            "helpful_notes": len(writer_helpful),
            "helpful_rate": round(len(writer_helpful) / len(writer_notes), 3),
            "median_hours_tweet_to_note": round(writer_notes["hoursToNote"].median(), 1),
            "median_hours_tweet_to_helpful": round(writer_helpful["hoursToHelpful"].median(), 1) if len(writer_helpful) else None,
            "share_of_helpful_that_were_first_on_tweet": round(writer_helpful["noteId"].isin(first_note_ids).mean(), 3) if len(writer_helpful) else None,
            **head_to_head(writer_helpful[["tweetId", "hoursToHelpful"]], human_first),
        })
    return pd.DataFrame(rows).sort_values("helpful_notes", ascending=False)


def timing_by_writer_type(notes: pd.DataFrame) -> pd.DataFrame:
    """Splits the time to a helpful note into writing time and rating time."""
    recent = notes[pd.to_datetime(notes["createdAtMillis"], unit="ms", utc=True) >= WRITER_TYPE_COMPARISON_START]
    rows = []
    for writer_type, group in recent.groupby("writerType"):
        helpful = group[group["hoursToHelpful"].between(0, MAX_HOURS_TO_HELPFUL)]
        rows.append({
            "writer_type": writer_type,
            "misleading_notes": len(group),
            "helpful_notes": len(helpful),
            "median_hours_tweet_to_helpful_note_written": round(helpful["hoursToNote"].median(), 1),
            "median_hours_note_written_to_helpful": round(((helpful["helpfulAtMillis"] - helpful["createdAtMillis"]) / MILLIS_PER_HOUR).median(), 1),
        })
    return pd.DataFrame(rows)


def ai_vs_human_on_same_tweets(notes: pd.DataFrame) -> pd.DataFrame:
    """On tweets where both an API writer and a human got a helpful note, who got there first?"""
    recent = notes[pd.to_datetime(notes["createdAtMillis"], unit="ms", utc=True) >= WRITER_TYPE_COMPARISON_START]
    helpful = recent[recent["hoursToHelpful"].between(0, MAX_HOURS_TO_HELPFUL)]
    first_per_type = helpful.sort_values("helpfulAtMillis").drop_duplicates(["tweetId", "writerType"])
    hours = first_per_type.pivot(index="tweetId", columns="writerType", values="hoursToHelpful")
    both = hours.dropna(subset=[WRITER_AI_API, WRITER_HUMAN])
    ai_lead_hours = both[WRITER_HUMAN] - both[WRITER_AI_API]
    return pd.DataFrame([{
        "tweets_with_ai_api_helpful": hours[WRITER_AI_API].notna().sum(),
        "of_which_also_human_helpful": len(both),
        "share_ai_first": round((ai_lead_hours > 0).mean(), 3),
        "share_tie": round((ai_lead_hours == 0).mean(), 3),
        "share_human_first": round((ai_lead_hours < 0).mean(), 3),
        "median_ai_lead_hours": round(ai_lead_hours.median(), 1),
    }])


def main() -> None:
    RESULTS_DIR.mkdir(exist_ok=True)
    notes = build_misleading_notes(load_ai_author_ids())
    first_helpful = first_helpful_note_per_tweet(notes)
    tables = {
        "monthly_speed": monthly_speed(first_helpful),
        "monthly_ai_share": monthly_ai_share(notes),
        "per_writer": per_writer(notes, first_helpful),
        "timing_by_writer_type": timing_by_writer_type(notes),
        "ai_vs_human_on_same_tweets": ai_vs_human_on_same_tweets(notes),
    }
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 20)
    for name, table in tables.items():
        table.to_csv(RESULTS_DIR / f"{name}.csv")
        print(f"\n=== {name} ===\n{table.to_string()}")


if __name__ == "__main__":
    main()
