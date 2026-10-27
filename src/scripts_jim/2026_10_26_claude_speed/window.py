"""The period the scripts measure.

Every script takes `--since` and `--until` as UTC dates, for example
`--since 2026-10-26 --until 2026-11-02` for one week. The end date is exclusive.
Without them the scripts measure the first audit's two weeks, 12 to 26 October.
Events outside the period are ignored, so a session that ran across the start
only counts with the part inside it.
"""
import argparse
import datetime as dt
import glob
import os

ROOT = os.path.expanduser("~/.claude/projects")
FIRST_AUDIT_SINCE = "2026-10-12"
FIRST_AUDIT_UNTIL = "2026-10-26"


def parse_window(argv):
    """Return (since, until, remaining arguments), with since and until as Unix timestamps."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", default=FIRST_AUDIT_SINCE)
    parser.add_argument("--until", default=FIRST_AUDIT_UNTIL)
    args, rest = parser.parse_known_args(argv)
    return to_timestamp(args.since), to_timestamp(args.until), rest


def to_timestamp(date):
    return dt.datetime.fromisoformat(date).replace(tzinfo=dt.timezone.utc).timestamp()


def transcripts(dir_prefix, since):
    """Main-thread transcripts of the repos whose session folders start with dir_prefix, written to after since."""
    return [f for f in glob.glob(f"{ROOT}/-home-jim-dev-repos-{dir_prefix}*/*.jsonl")
            if os.path.getmtime(f) >= since]


def in_window(record, since, until):
    """Whether a transcript line was written inside the period."""
    stamp = record.get("timestamp")
    return bool(stamp) and since <= dt.datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() < until
