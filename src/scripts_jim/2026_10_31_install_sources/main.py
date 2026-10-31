"""Where the extension installs of 2026-10-29 and 2026-10-30 came from (GOO-678).

Every number is an aggregate. Nothing here prints a device id, a user id or an
IP address. Run from the repository root:

    uv run --with requests --with python-dotenv src/scripts_jim/2026_10_31_install_sources/main.py
"""

from collections import Counter
from datetime import datetime, timedelta, timezone

import requests

from prod_sql import ACCESS_TOKEN, PROJECT_REF, REQUEST_TIMEOUT_SECONDS, USER_AGENT, run_sql

# The first hour with more than a handful of installs. Scott Alexander's
# "Links For October 2026" went out at 16:33 UTC that day.
SPIKE_START = datetime(2026, 10, 29, 16, tzinfo=timezone.utc)
BASELINE_DAYS = 14
BASELINE_START = SPIKE_START - timedelta(days=BASELINE_DAYS)
HOURLY_WINDOW = timedelta(hours=24)
# The edge logs answer at most 24 hours per query, and they reach back about
# ten days. The countries compare the spike with the days before it.
LOGS_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/analytics/endpoints/logs"
LOGS_HISTORY_START = datetime(2026, 10, 20, tzinfo=timezone.utc)
LOGS_MAX_SPAN = timedelta(hours=24)
# The logs endpoint may return fewer rows than the query asks for. A window
# that comes back this full was probably cut short.
LOGS_ROW_LIMIT = 1000
TOP_COUNTRIES = 12
TOP_PROJECTS = 10

STORE_INSTALL = "e.props ->> 'install_type' is distinct from 'development'"
NOT_ADMIN = """(e.user_id is null or e.user_id not in (
  select u.id from auth.users u join everything_admins a on a.email = lower(u.email)))"""
# The kind of page a website visitor first landed on, from the pageview's URL.
LANDING_KIND = r"""case
  when url ~ '[?&]note=' then 'note link'
  when url ~ '/minisites/.' then 'minisite'
  when url ~ '/leaderboard' then 'leaderboard'
  when url ~ '/notes' then 'notes list or project page'
  when url ~ '/x-notewriter' then 'X notewriter page'
  when url ~ '/admin' then 'admin page'
  when url ~ '^https?://[^/]+/(install/?)?(\?.*)?$' then 'homepage'
  else 'other' end"""
UTM_SOURCE = "coalesce(substring(url from '[?&]utm_source=([^&]+)'), '')"


def ts(moment: datetime) -> str:
    return moment.isoformat()


def logs_ts(moment: datetime) -> str:
    """The logs endpoint takes only the Z form of an ISO timestamp."""
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def print_table(title: str, rows: list[dict]) -> None:
    print(f"\n## {title}\n")
    if not rows:
        print("(no rows)")
        return
    columns = list(rows[0])
    print("| " + " | ".join(columns) + " |")
    print("|" + "---|" * len(columns))
    for row in rows:
        print("| " + " | ".join(str(row[c]) for c in columns) + " |")


def daily_installs_and_clicks() -> list[dict]:
    return run_sql(f"""
      with days as (
        select generate_series('{BASELINE_START.date()}'::date, current_date, '1 day')::date as day),
      installs as (
        select (e.created_at at time zone 'utc')::date as day,
          count(distinct e.device_id) filter (where e.props ->> 'browser' = 'chrome') as chrome,
          count(distinct e.device_id) filter (where e.props ->> 'browser' = 'firefox') as firefox,
          count(distinct e.device_id) filter (where e.props ->> 'browser' = 'safari') as safari,
          count(distinct e.device_id) as installs
        from everything_events e
        where e.event = 'extension_installed' and {STORE_INSTALL}
        group by 1),
      web as (
        select (e.created_at at time zone 'utc')::date as day,
          count(distinct e.device_id) filter (where e.event = 'pageview') as site_visitors,
          count(distinct e.device_id) filter (where e.event = 'get_extension_clicked') as get_extension_clickers,
          count(distinct e.device_id) filter (where e.event = 'extension_store_clicked') as store_clickers
        from everything_events e
        where e.platform = 'web' and {NOT_ADMIN}
          and e.event in ('pageview', 'get_extension_clicked', 'extension_store_clicked')
        group by 1)
      select d.day, coalesce(i.installs, 0) installs, coalesce(i.chrome, 0) chrome,
        coalesce(i.firefox, 0) firefox, coalesce(i.safari, 0) safari,
        coalesce(w.site_visitors, 0) site_visitors,
        coalesce(w.get_extension_clickers, 0) get_extension_clickers,
        coalesce(w.store_clickers, 0) store_clickers
      from days d left join installs i using (day) left join web w using (day)
      where d.day >= '{BASELINE_START.date()}'
      order by d.day""")


def hourly_spike_start() -> list[dict]:
    start = SPIKE_START - timedelta(hours=3)
    return run_sql(f"""
      select to_char(date_trunc('hour', e.created_at at time zone 'utc'), 'MM-DD HH24:00') as hour_utc,
        count(distinct e.device_id) filter (where e.event = 'extension_installed' and {STORE_INSTALL}) installs,
        count(distinct e.device_id) filter (where e.event = 'pageview') site_visitors,
        count(distinct e.device_id) filter (where e.event = 'pageview' and e.props ->> 'url' ~ 'utm_source=substack') substack_email_visitors,
        count(distinct e.device_id) filter (where e.event = 'extension_store_clicked') store_clickers
      from everything_events e
      where e.created_at >= '{ts(start)}' and e.created_at < '{ts(SPIKE_START + HOURLY_WINDOW)}'
        and (e.platform = 'extension' or {NOT_ADMIN})
      group by 1 order by 1""")


def store_clickers_by_landing() -> list[dict]:
    """The first page each device that clicked through to a store ever loaded,
    and the button it clicked first."""
    return run_sql(f"""
      with clickers as (
        select e.device_id, min(e.created_at) first_store_click
        from everything_events e
        where e.platform = 'web' and e.event = 'extension_store_clicked'
          and e.created_at >= '{ts(SPIKE_START)}' and {NOT_ADMIN}
        group by 1),
      buttons as (
        select distinct on (e.device_id) e.device_id, e.props ->> 'button' as button
        from everything_events e join clickers c using (device_id)
        where e.event = 'get_extension_clicked' order by e.device_id, e.created_at),
      landing as (
        select distinct on (c.device_id) c.device_id, e.props ->> 'url' as url,
          extract(epoch from c.first_store_click - e.created_at) / 60 as minutes_to_click
        from clickers c join everything_events e
          on e.device_id = c.device_id and e.platform = 'web' and e.event = 'pageview'
        order by c.device_id, e.created_at)
      select {LANDING_KIND} as landing_page, {UTM_SOURCE} as utm_source,
        coalesce(b.button, '(store button without a get-extension click)') as first_button,
        count(*) as devices,
        round(percentile_cont(0.5) within group (order by minutes_to_click)::numeric, 1) as median_minutes_to_click
      from landing l left join buttons b using (device_id)
      group by 1, 2, 3 order by devices desc""")


def new_visitors_by_landing() -> list[dict]:
    """Every website device by the first page it ever loaded, in the spike and
    in the two weeks before it."""
    return run_sql(f"""
      with firsts as (
        select distinct on (e.device_id) e.props ->> 'url' as url, e.created_at
        from everything_events e
        where e.platform = 'web' and e.event = 'pageview' and {NOT_ADMIN}
        order by e.device_id, e.created_at)
      select {LANDING_KIND} as landing_page, {UTM_SOURCE} as utm_source,
        count(*) filter (where created_at >= '{ts(SPIKE_START)}') as since_spike,
        count(*) filter (where created_at >= '{ts(BASELINE_START)}' and created_at < '{ts(SPIKE_START)}') as previous_{BASELINE_DAYS}_days
      from firsts where created_at >= '{ts(BASELINE_START)}'
      group by 1, 2 order by since_spike desc, 4 desc""")


def first_creator_shown_to_new_installs() -> list[dict]:
    """For each install since the spike, the creator of the first page on which
    the extension showed it notes."""
    return run_sql(f"""
      with new_installs as (
        select distinct e.device_id from everything_events e
        where e.event = 'extension_installed' and {STORE_INSTALL} and e.created_at >= '{ts(SPIKE_START)}'),
      first_shown as (
        select distinct on (e.device_id) e.device_id, (e.props ->> 'item_id') as item_id
        from everything_events e join new_installs using (device_id)
        where e.event = 'notes_shown' order by e.device_id, e.created_at)
      select coalesce(p.slug, '(no notes shown yet)') as first_creator_with_notes, count(*) as installs
      from new_installs n
      left join first_shown f using (device_id)
      left join everything_items i on i.id::text = f.item_id
      left join everything_projects p on p.id = i.project_id
      group by 1 order by 2 desc limit {TOP_PROJECTS}""")


def query_logs(sql: str, start: datetime, end: datetime) -> list[dict]:
    response = requests.get(
        LOGS_URL,
        params={"sql": sql, "iso_timestamp_start": logs_ts(start), "iso_timestamp_end": logs_ts(end)},
        headers={"Authorization": f"Bearer {ACCESS_TOKEN}", "User-Agent": USER_AGENT},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    body = response.json()
    if not response.ok or "error" in body:
        raise RuntimeError(f"{response.status_code}: {body}")
    return body["result"]


def extension_addresses(start: datetime, end: datetime) -> dict[int, str]:
    """Hashed client addresses that inserted analytics events from the extension
    between start and end, each with its country. The extension's requests carry
    no Referer header, while the website's carry commonnotes.net. ClickHouse
    hashes the address, so no address reaches this script."""
    sql = """select cityHash64(log_attributes['request.headers.cf_connecting_ip']) as address,
               any(log_attributes['request.cf.country']) as country
             from logs
             where source = 'edge_logs' and event_message like 'POST%everything_events%'
               and log_attributes['request.headers.referer'] = ''
             group by address
             limit 100000"""
    addresses: dict[int, str] = {}
    window_start = start
    while window_start < end:
        window_end = min(window_start + LOGS_MAX_SPAN, end)
        rows = query_logs(sql, window_start, window_end)
        if len(rows) >= LOGS_ROW_LIMIT:
            raise RuntimeError(f"The logs endpoint cut the result at {len(rows)} rows")
        for row in rows:
            addresses.setdefault(int(row["address"]), row["country"])
        window_start = window_end
    return addresses


def new_extension_countries() -> tuple[list[dict], int]:
    """Countries of the addresses that sent extension events after the spike
    began and never in the days before it. An address is only a rough stand-in
    for an install: an existing reader on a new network counts as new, and
    several readers behind one address count once."""
    before = extension_addresses(LOGS_HISTORY_START, SPIKE_START)
    since = extension_addresses(SPIKE_START, datetime.now(timezone.utc))
    new_countries = Counter(country for address, country in since.items() if address not in before)
    rows = [{"country": c, "new_addresses": n} for c, n in new_countries.most_common(TOP_COUNTRIES)]
    return rows, sum(new_countries.values())


def main() -> None:
    print(f"Spike start: {ts(SPIKE_START)}. Baseline: the {BASELINE_DAYS} days before it.")
    print_table("Installs and website clicks per UTC day (admins left out of the website columns)", daily_installs_and_clicks())
    print_table("Hourly around the start of the spike (UTC)", hourly_spike_start())
    print_table("Devices that clicked through to a store since the spike, by their first page", store_clickers_by_landing())
    print_table("New website devices by their first page", new_visitors_by_landing())
    print_table("New installs since the spike, by the creator of the first page with notes", first_creator_shown_to_new_installs())
    country_rows, new_total = new_extension_countries()
    print_table(f"Countries of new extension addresses since the spike ({new_total} in all)", country_rows)


if __name__ == "__main__":
    main()
