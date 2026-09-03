# /// script
# requires-python = ">=3.10"
# dependencies = ["psycopg2-binary", "python-dotenv"]
# ///
"""Per-arm readout for every A/B test that is still sampling (GOO-93).

For each live test this prints one row per arm: how many runs it got, over
which date window, how many notes were submitted, and how the settled notes
were rated. A note counts as settled 48 hours after submission, the same
convention the anti-pedantic and prefilter closeouts used. "net" is
(helpful - not_helpful) / settled notes.

For two-arm tests it also prints a two-proportion z statistic on the helpful
rate between the arms, so a gap can be told apart from noise.

Run from the workspace root:
  uv run src/scripts_jim/2026_09_01_ab_test_review/ab_readout.py
"""

import math
import os

import psycopg2
from dotenv import load_dotenv

load_dotenv()

# The tests where more than one arm has a nonzero weight in abTestsData.ts,
# i.e. the ones production is still splitting traffic over.
LIVE_TESTS = [
    "simple_bot_search",
    "simple_bot_writer",
    "simple_bot_political_sources",
    "timing_treatment",
    "simple_bot_writer_examples",
    "simple_bot_correction_extraction",
    "topic_filter",
    "verifier_claim_based",
    "verifier_citations",
    "misinfo_concede_shape",
    "pangram_note",
    "author_history",
]

ARM_SQL = """
select
  r.ab_test_picks->>%(test)s as arm,
  count(*) as runs,
  min(r.created_at)::date as first_run,
  max(r.created_at)::date as last_run,
  count(*) filter (where r.outcome = 'submitted') as submitted_runs,
  round(sum(r.cost)::numeric, 2) as cost_usd,
  count(*) filter (where n.submitted_at is not null
                   and n.submitted_at < now() - interval '48 hours') as settled,
  count(*) filter (where n.submitted_at < now() - interval '48 hours'
                   and n.cn_status = 'CURRENTLY_RATED_HELPFUL') as helpful,
  count(*) filter (where n.submitted_at < now() - interval '48 hours'
                   and n.cn_status = 'CURRENTLY_RATED_NOT_HELPFUL') as not_helpful
from pipeline_runs r
left join notes n on n.note_id = r.note_id
where r.ab_test_picks ? %(test)s
  and r.created_at >= %(since)s
group by 1
order by runs desc
"""


def two_proportion_z(k1: int, n1: int, k2: int, n2: int) -> float | None:
    """z statistic for the difference of two independent proportions."""
    if n1 == 0 or n2 == 0:
        return None
    p1, p2 = k1 / n1, k2 / n2
    pooled = (k1 + k2) / (n1 + n2)
    se = math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
    if se == 0:
        return None
    return (p1 - p2) / se


def print_test(cur, test: str, since: str) -> list[tuple]:
    cur.execute(ARM_SQL, {"test": test, "since": since})
    rows = cur.fetchall()
    cols = [d.name for d in cur.description]
    print(f"\n### {test} (runs since {since})")
    header = cols + ["net", "helpful_rate"]
    print(" | ".join(header))
    for row in rows:
        arm, runs, first, last, sub, cost, settled, h, nh = row
        net = f"{(h - nh) / settled * 100:+.1f}%" if settled else "-"
        rate = f"{h / settled * 100:.1f}%" if settled else "-"
        print(" | ".join(str(x) for x in row) + f" | {net} | {rate}")
    return rows


def print_pairwise(rows: list[tuple]) -> None:
    """Print the helpful-rate z statistic for every pair of arms."""
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            a, b = rows[i], rows[j]
            z = two_proportion_z(a[7], a[6], b[7], b[6])
            if z is not None:
                print(f"  z(helpful rate, {a[0]} vs {b[0]}) = {z:+.2f}")


def main() -> None:
    conn = psycopg2.connect(os.environ["PROD_DB_URL"])
    cur = conn.cursor()

    # All time first, then the last 30 days, because several tests changed
    # their weights over the summer and only the recent window compares arms
    # under the same conditions.
    for since in ("2026-01-01", "2026-08-01"):
        print(f"\n{'=' * 70}\n== Window starting {since}\n{'=' * 70}")
        for test in LIVE_TESTS:
            rows = print_test(cur, test, since)
            if 2 <= len(rows) <= 4:
                print_pairwise(rows)


if __name__ == "__main__":
    main()
