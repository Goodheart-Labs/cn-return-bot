# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""What our own cost rows say the pipelines spent, split by who was paid (GOO-461).

Both pipelines record the cost of every LLM step in their run rows:
`pipeline_runs` for the X bot and `everything_pipeline_runs` for Common Notes.
Each step is one entry in logs->'costs'->'entries'. Some steps call a vendor
directly with our own vendor key, and only the rest go through OpenRouter. This
script labels every entry with the route that paid for it, so the OpenRouter
part can be compared with the key's limit.

Read-only. Queries prod through the Supabase management API with the CLI token
in ~/.supabase/access-token, the same way scripts/apply_086.py does, inside a
read-only transaction.

Run from the workspace root:
    uv run src/scripts_jim/2026_10_18_openrouter_spend/db_spend.py
"""

import csv
import json
import urllib.request
from pathlib import Path

PROJECT_REF = "ugytvkevhsmcpunfvncw"
OUT_DIR = Path(__file__).parent / "results"
SINCE = "2026-09-15"
MONTH_START = "2026-10-01"

# One row per recorded cost entry, labelled with its product, route and model.
# The routes follow the code on main as of 2026-10-18:
# - inputs.comments asks Grok on xAI's own API (src/pipeline/input/comments.ts).
# - Search with web_search native_grok or native_gemini calls xAI or Google
#   directly. Every other search mode runs through OpenRouter
#   (src/pipeline/ab-testing/botConfig.ts).
# - Serper is a paid search API, and Whisper transcription runs on Groq.
# - Media described by a Gemini model goes to Google directly
#   (src/pipeline/media/mediaAnalysisGemini.ts). Video always does.
# - Common Notes rows without entries are extraction, rating and small
#   per-item steps, which all run on EVERYTHING_MODEL through OpenRouter.
ENTRIES_SQL = f"""
with x as (
  select p.created_at, 'xbot' as product, e->>'name' as stage, (e->>'cost')::numeric as cost,
         p.bot_config->>'web_search' as web_search, p.bot_config->>'search_model' as search_model,
         p.ab_test_picks->>'media_description' as media_pick
  from pipeline_runs p, jsonb_array_elements(coalesce(p.logs->'costs'->'entries', '[]'::jsonb)) e
  where p.created_at >= '{SINCE}'
),
cn_entries as (
  select r.created_at, 'commonnotes' as product, e->>'name' as stage, (e->>'cost')::numeric as cost,
         case when r.ab_test_picks->>'simple_bot_search' like '%-native' and r.ab_test_picks->>'simple_bot_search' not like 'gemini%'
                   and r.ab_test_picks->>'simple_bot_search' not like 'grok%' then 'openrouter_native' end as web_search,
         r.ab_test_picks->>'simple_bot_search' as search_model,
         r.ab_test_picks->>'media_description' as media_pick
  from everything_pipeline_runs r, jsonb_array_elements(r.logs->'costs'->'entries') e
  where r.created_at >= '{SINCE}' and jsonb_array_length(coalesce(r.logs->'costs'->'entries', '[]'::jsonb)) > 0
),
cn_plain as (
  select r.created_at, 'commonnotes', r.kind, r.cost, null, null, null
  from everything_pipeline_runs r
  where r.created_at >= '{SINCE}' and jsonb_array_length(coalesce(r.logs->'costs'->'entries', '[]'::jsonb)) = 0
),
entries as (select * from x union all select * from cn_entries union all select * from cn_plain)
select created_at, product, stage, cost,
  case
    when stage like 'inputs.comments%' then 'xai_direct'
    when stage = 'search' and web_search = 'native_grok' then 'xai_direct'
    when stage = 'search' and web_search = 'native_gemini' then 'google_direct'
    when stage like '%serper%' then 'serper'
    when stage like '%whisper%' then 'groq_direct'
    when stage like 'media.%video%' then 'google_direct'
    when stage like 'media.%' and stage not like '%.haiku' and media_pick like 'gemini%' then 'google_direct'
    else 'openrouter'
  end as route,
  case
    when stage = 'search' then coalesce(search_model, '?')
    when product = 'commonnotes' then 'commonnotes pipeline model'
    else 'other X bot steps'
  end as model_or_group
from entries
"""


def query(sql: str) -> list[dict]:
    token = Path.home().joinpath(".supabase/access-token").read_text().strip()
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": "set transaction read only;\n" + sql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "curl/8.5.0"},
        method="POST",
    )
    return json.load(urllib.request.urlopen(request, timeout=600))


def write_csv(name: str, rows: list[dict]) -> None:
    with open(OUT_DIR / f"{name}.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    write_csv("db_daily_by_route", query(f"""
        with c as ({ENTRIES_SQL})
        select created_at::date as utc_day,
          round(sum(cost) filter (where route = 'openrouter' and product = 'commonnotes'), 2) as openrouter_commonnotes,
          round(sum(cost) filter (where route = 'openrouter' and product = 'xbot'), 2) as openrouter_xbot,
          round(sum(cost) filter (where route = 'openrouter'), 2) as openrouter_total,
          round(sum(sum(cost) filter (where route = 'openrouter' and created_at >= '{MONTH_START}'))
                over (partition by date_trunc('month', created_at::date) order by created_at::date), 2) as openrouter_month_to_date,
          round(sum(cost) filter (where route = 'xai_direct'), 2) as xai_direct,
          round(sum(cost) filter (where route = 'google_direct'), 2) as google_direct,
          round(sum(cost) filter (where route in ('serper', 'groq_direct')), 2) as serper_and_groq,
          round(sum(cost), 2) as all_recorded
        from c group by 1 order by 1
    """))
    write_csv("db_openrouter_by_model_month", query(f"""
        with c as ({ENTRIES_SQL})
        select product, model_or_group, round(sum(cost), 2) as cost, count(*) as calls, round(avg(cost), 4) as cost_per_call
        from c where route = 'openrouter' and created_at >= '{MONTH_START}'
        group by 1, 2 order by 3 desc
    """))
    write_csv("db_openrouter_day_by_model", query(f"""
        with c as ({ENTRIES_SQL})
        select created_at::date as utc_day, product, model_or_group, round(sum(cost), 2) as cost, count(*) as calls
        from c where route = 'openrouter' group by 1, 2, 3 order by 1, 4 desc
    """))
    write_csv("db_openrouter_hourly_month", query(f"""
        with c as ({ENTRIES_SQL})
        select date_trunc('hour', created_at) as utc_hour, round(sum(cost), 2) as openrouter_cost,
          round(sum(sum(cost)) over (order by date_trunc('hour', created_at)), 2) as month_to_date
        from c where route = 'openrouter' and created_at >= '{MONTH_START}'
        group by 1 order by 1
    """))


if __name__ == "__main__":
    main()
