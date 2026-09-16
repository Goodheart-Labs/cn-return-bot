# /// script
# dependencies = []
# ///
"""Counts the web_fetch calls the X bot's search loop made and how many failed.

The verifier is not the only caller of fetchWebPage: the Serper search loop
(searchDispatch.ts) lets the model call web_fetch while it researches, and its
conversation lands under note_writer_steps.search. A failed call leaves a tool
result that starts with "Fetch failed:" or "Fetch error:". The search prompts
never mention those strings, so the count is exact.

    uv run src/scripts_jim/2026_09_16_unfetchable_sources/01c_count_search_loop_fetches.py
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module
extract = import_module("01_extract_failures")

SEARCH = "(logs->'note_writer_steps'->'search')::text"


def day_sql(day: int) -> str:
    return f"""
    select count(*) as runs_with_search,
           sum(regexp_count({SEARCH}, '"name":\s*"web_fetch"')) as web_fetch_calls,
           sum(regexp_count({SEARCH}, 'web_fetch')) as web_fetch_mentions,
           sum(regexp_count({SEARCH}, 'Fetch failed: ')) as fetch_failed,
           sum(regexp_count({SEARCH}, 'Fetch error: ')) as fetch_error,
           sum(regexp_count({SEARCH}, 'fetched via (wayback|archive.ph) snapshot')) as via_archive,
           sum(regexp_count({SEARCH}, 'fetched via headless browser')) as via_browser
    from pipeline_runs
    where created_at >= now() - interval '{day + 1} days' and created_at < now() - interval '{day} days'
      and logs ? 'note_writer_steps' and logs->'note_writer_steps' ? 'search';
    """


if __name__ == "__main__":
    total: dict[str, int] = {}
    for day in range(extract.DAYS):
        row = extract.query(day_sql(day))[0]
        print(f"day {day}: {row}", file=sys.stderr)
        for k, v in row.items():
            total[k] = total.get(k, 0) + int(v or 0)
    (extract.OUT / "x_search_loop_fetch_counts_14d.json").write_text(json.dumps(total, indent=1))
    print(json.dumps(total, indent=1))
