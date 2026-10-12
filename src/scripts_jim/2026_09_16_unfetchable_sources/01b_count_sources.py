# /// script
# dependencies = []
# ///
"""Counts, per day, how many cited sources the X verifier saw and how each ended.

Same log path and same management API as 01_extract_failures.py. The regexes
run inside Postgres so the log text never leaves the database.

    uv run src/scripts_jim/2026_09_16_unfetchable_sources/01b_count_sources.py
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module
extract = import_module("01_extract_failures")

SV = "(logs->'note_writer_steps'->'source_verifier')::text"
COUNTS = {
    "sources_seen": r"### https?://",
    "sources_failed": r"### https?://[^\"\\]+\\nFetch (failed|error):",
    "sources_snippet_only": r"### https?://[^\"\\]+\\n\[from search snippet",
    "sources_via_archive": r"### https?://[^\"\\]+\\n\[fetched via (wayback|archive\.ph) snapshot",
    "sources_via_browser": r"### https?://[^\"\\]+\\n\[fetched via headless browser",
    "sources_media_analysis": r"### https?://[^\"\\]+\\nAutomated (video|image) analysis",
    "sources_tweet": r"### https?://[^\"\\]+\\nTwitter/X (post|link)",
}


def day_sql(day: int) -> str:
    cols = ",\n".join(f"sum(regexp_count({SV}, '{rx}')) as {name}" for name, rx in COUNTS.items())
    return f"""
    select count(*) as runs_with_verifier, {cols},
           count(*) filter (where error_message like '%could be fetched%') as runs_unfetchable_error
    from pipeline_runs
    where created_at >= now() - interval '{day + 1} days' and created_at < now() - interval '{day} days'
      and logs ? 'note_writer_steps' and logs->'note_writer_steps' ? 'source_verifier';
    """


if __name__ == "__main__":
    total: dict[str, int] = {}
    for day in range(extract.DAYS):
        row = extract.query(day_sql(day))[0]
        print(f"day {day}: {row}", file=sys.stderr)
        for k, v in row.items():
            total[k] = total.get(k, 0) + int(v or 0)
    (extract.OUT / "x_verifier_source_counts_14d.json").write_text(json.dumps(total, indent=1))
    print(json.dumps(total, indent=1))
