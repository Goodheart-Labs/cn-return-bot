# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""How often does an extension reader vote on a page where the extension showed notes? (GOO-434)

Read-only. Queries prod through the Supabase management API with the CLI token
in ~/.supabase/access-token, the same way scripts/apply_086.py does.

Run from the workspace root:
    uv run src/scripts_jim/2026_10_13_vote_probability/main.py
"""

import json
import math
import random
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_REF = "ugytvkevhsmcpunfvncw"
OUT_DIR = Path(__file__).parent

# A reload or a second tab of the same page within this gap is the same visit.
SAME_VISIT_GAP = timedelta(minutes=30)
# An anonymous vote is attributed to the browsers that had notes shown on the
# same page in this window before the vote.
MATCH_WINDOW_BEFORE = timedelta(hours=6)
# Both timestamps come from the database clock, but a vote can land a moment
# before the notes_shown insert that the same page load sent.
MATCH_SLACK_AFTER = timedelta(minutes=1)
# The day from which every extension event carries install_type (version 0.4.1).
INSTALL_TYPE_SINCE = datetime.fromisoformat("2026-10-06T00:00:00+00:00")
BOOTSTRAP_SAMPLES = 10_000
Z_95 = 1.96


def run_sql(sql: str) -> list[dict]:
    token = Path.home().joinpath(".supabase/access-token").read_text().strip()
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql, "read_only": True}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "curl/8.5.0"},
    )
    return json.loads(urllib.request.urlopen(request, timeout=120).read())


TEAM_USERS_SQL = """
select u.id from auth.users u
where lower(u.email) in (select lower(email) from everything_admins)
   or u.email ilike '%@goodheartlabs.com'
"""

# Every notes_shown event, with what the device ever revealed about itself.
SHOWN_SQL = """
with device as (
  select device_id,
         bool_or(props->>'install_type' = 'development') as dev_install,
         bool_or(props->>'browser' = 'safari') as safari,
         array_remove(array_agg(distinct user_id), null) as user_ids,
         min(created_at) filter (where event = 'extension_installed') as installed_at
  from everything_events where platform = 'extension' group by device_id
)
select e.device_id, e.user_id, e.created_at, (e.props->>'item_id') as item_id, e.props->>'surface' as surface,
       coalesce((e.props->>'note_count')::int, 0) as note_count,
       d.dev_install, d.safari, d.user_ids
from everything_events e join device d using (device_id)
where e.event = 'notes_shown' and e.platform = 'extension'
order by e.created_at
"""

VOTES_SQL = """
select v.voter_id, v.note_id, c.item_id, v.created_at, coalesce(v.platform, 'unknown') as platform, u.is_anonymous
from everything_votes v
join everything_notes n on n.id = v.note_id
join everything_claims c on c.id = n.claim_id
join auth.users u on u.id = v.voter_id
order by v.created_at
"""


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace(" ", "T"))


@dataclass
class Visit:
    device: str
    item: str
    surface: str
    started: datetime
    note_count: int
    signed_in: bool
    first_for_device: bool = False
    ended: datetime | None = None  # start of the device's next visit to the same page
    voted_notes: set[str] = field(default_factory=set)


@dataclass
class Device:
    team: bool
    team_reason: str | None
    user_ids: set[str]


def load_devices(shown_rows: list[dict], team_users: set[str]) -> dict[str, Device]:
    devices = {}
    for row in shown_rows:
        if row["device_id"] in devices:
            continue
        user_ids = set(row["user_ids"] or [])
        reason = (
            "development install" if row["dev_install"]
            else "Safari (no store listing)" if row["safari"]
            else "signed in as a team account" if user_ids & team_users
            else None
        )
        devices[row["device_id"]] = Device(team=reason is not None, team_reason=reason, user_ids=user_ids)
    return devices


def build_visits(shown_rows: list[dict]) -> list[Visit]:
    """Collapses reloads into visits and marks each device's first page with notes."""
    visits: list[Visit] = []
    last_by_page: dict[tuple[str, str], Visit] = {}
    seen_devices: set[str] = set()
    for row in shown_rows:
        started = parse_time(row["created_at"])
        key = (row["device_id"], row["item_id"])
        previous = last_by_page.get(key)
        if previous and started - previous.started <= SAME_VISIT_GAP:
            previous.note_count = max(previous.note_count, row["note_count"])
            previous.signed_in |= row["user_id"] is not None
            continue
        if previous:
            previous.ended = started
        visit = Visit(
            device=row["device_id"], item=row["item_id"], surface=row["surface"], started=started,
            note_count=row["note_count"], signed_in=row["user_id"] is not None,
            first_for_device=row["device_id"] not in seen_devices,
        )
        seen_devices.add(row["device_id"])
        visits.append(visit)
        last_by_page[key] = visit
    return visits


def candidate_devices(vote: dict, visits_by_item: dict[str, list[Visit]]) -> set[str]:
    voted_at = parse_time(vote["created_at"])
    return {
        v.device for v in visits_by_item.get(vote["item_id"], [])
        if voted_at - MATCH_WINDOW_BEFORE <= v.started <= voted_at + MATCH_SLACK_AFTER
    }


def link_voters_to_devices(
    votes: list[dict], visits: list[Visit], devices: dict[str, Device]
) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """Which browser cast each voter's votes.

    A signed-in reader's events carry their user id, so their browser is known.
    An anonymous reader's events carry no user id. For them we look at every
    vote they cast and collect the browsers that were showing notes on the same
    page in the hours before. The browser that appears for all of their votes is
    theirs. When several browsers remain, a browser already claimed by another
    voter is dropped, and this repeats until nothing changes. Voters who still
    have zero or several browsers stay unlinked and are reported."""
    visits_by_item: dict[str, list[Visit]] = defaultdict(list)
    for visit in visits:
        visits_by_item[visit.item].append(visit)

    links: dict[str, set[str]] = defaultdict(set)
    for device_id, device in devices.items():
        for user_id in device.user_ids:
            links[user_id].add(device_id)

    candidates_by_voter: dict[str, set[str] | None] = {}
    for vote in votes:
        if vote["voter_id"] in links:
            continue
        candidates = candidate_devices(vote, visits_by_item)
        if not candidates:
            continue
        known = candidates_by_voter.get(vote["voter_id"])
        candidates_by_voter[vote["voter_id"]] = candidates if known is None else (known & candidates or known | candidates)

    changed = True
    while changed:
        changed = False
        claimed = {d for voter, ds in links.items() if len(ds) == 1 for d in ds}
        for voter, candidates in candidates_by_voter.items():
            if voter in links:
                continue
            remaining = candidates - claimed if len(candidates) > 1 else candidates
            if len(remaining) == 1:
                links[voter] = set(remaining)
                changed = True
    unlinked = {voter: candidates_by_voter.get(voter) or set() for voter in {v["voter_id"] for v in votes} - set(links)}
    return links, unlinked


def attach_votes(visits: list[Visit], votes: list[dict], links: dict[str, set[str]]) -> list[dict]:
    """Puts each linked vote on the visit it happened in. Returns the votes that fit no visit."""
    visits_by_page: dict[tuple[str, str], list[Visit]] = defaultdict(list)
    for visit in visits:
        visits_by_page[(visit.device, visit.item)].append(visit)
    orphans = []
    for vote in votes:
        voted_at = parse_time(vote["created_at"])
        home = None
        for device in links.get(vote["voter_id"], ()):
            for visit in visits_by_page.get((device, vote["item_id"]), []):
                if visit.started - MATCH_SLACK_AFTER <= voted_at and (visit.ended is None or voted_at < visit.ended):
                    home = visit
        if home:
            home.voted_notes.add(vote["note_id"])
        else:
            orphans.append(vote)
    return orphans


def wilson(successes: int, n: int) -> tuple[float, float]:
    if n == 0:
        return (math.nan, math.nan)
    p = successes / n
    centre = (p + Z_95**2 / (2 * n)) / (1 + Z_95**2 / n)
    half = Z_95 * math.sqrt(p * (1 - p) / n + Z_95**2 / (4 * n * n)) / (1 + Z_95**2 / n)
    return (centre - half, centre + half)


def cluster_bootstrap(visits: list[Visit], rng: random.Random) -> tuple[float, float]:
    """95% interval for the visit vote rate, resampling whole devices.

    Visits from one browser are not independent: one keen voter can supply a
    large share of the successes. Resampling devices keeps that dependence."""
    by_device: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for visit in visits:
        by_device[visit.device][0] += bool(visit.voted_notes)
        by_device[visit.device][1] += 1
    clusters = list(by_device.values())
    if not clusters:
        return (math.nan, math.nan)
    rates = []
    for _ in range(BOOTSTRAP_SAMPLES):
        sample = [clusters[rng.randrange(len(clusters))] for _ in clusters]
        rates.append(sum(s for s, _ in sample) / sum(n for _, n in sample))
    rates.sort()
    return (rates[int(0.025 * len(rates))], rates[int(0.975 * len(rates)) - 1])


def summarise(label: str, visits: list[Visit], rng: random.Random) -> dict:
    voted = sum(bool(v.voted_notes) for v in visits)
    notes_shown = sum(v.note_count for v in visits)
    notes_voted = sum(len(v.voted_notes) for v in visits)
    devices = {v.device for v in visits}
    voting_devices = {v.device for v in visits if v.voted_notes}
    return {
        "label": label,
        "visits": len(visits),
        "devices": len(devices),
        "voted": voted,
        "rate": voted / len(visits) if visits else math.nan,
        "wilson": wilson(voted, len(visits)),
        "bootstrap": cluster_bootstrap(visits, rng),
        "voting_devices": len(voting_devices),
        "notes_shown": notes_shown,
        "notes_voted": notes_voted,
        "per_note": notes_voted / notes_shown if notes_shown else math.nan,
    }


def pct(x: float) -> str:
    return "n/a" if math.isnan(x) else f"{100 * x:.1f}%"


def table(rows: list[dict]) -> str:
    lines = [
        "| Group | Visits | Browsers | Visits with a vote | P(vote) | 95% CI, Wilson | 95% CI, browser bootstrap | Browsers that voted | Notes shown | Notes voted on | Votes per note shown |",
        "|---|---:|---:|---:|---:|---|---|---:|---:|---:|---:|",
    ]
    for r in rows:
        lines.append(
            f"| {r['label']} | {r['visits']} | {r['devices']} | {r['voted']} | {pct(r['rate'])} | "
            f"{pct(r['wilson'][0])} to {pct(r['wilson'][1])} | {pct(r['bootstrap'][0])} to {pct(r['bootstrap'][1])} | "
            f"{r['voting_devices']} | {r['notes_shown']} | {r['notes_voted']} | {pct(r['per_note'])} |"
        )
    return "\n".join(lines)


def breakdowns(visits: list[Visit], rng: random.Random) -> list[dict]:
    groups = [
        ("All", lambda v: True),
        ("Text pages (Substack, LessWrong, other sites)", lambda v: v.surface == "inline"),
        ("YouTube videos", lambda v: v.surface == "youtube"),
        ("Browser's first page with notes", lambda v: v.first_for_device),
        ("Later pages", lambda v: not v.first_for_device),
        ("Signed in", lambda v: v.signed_in),
        ("Not signed in", lambda v: not v.signed_in),
    ]
    return [summarise(label, [v for v in visits if keep(v)], rng) for label, keep in groups]


def main() -> None:
    rng = random.Random(0)
    team_users = {row["id"] for row in run_sql(TEAM_USERS_SQL)}
    shown_rows = run_sql(SHOWN_SQL)
    all_votes = run_sql(VOTES_SQL)
    extension_votes = [v for v in all_votes if v["platform"] == "extension"]

    devices = load_devices(shown_rows, team_users)
    visits = build_visits(shown_rows)
    links, unlinked = link_voters_to_devices(extension_votes, visits, devices)
    orphans = attach_votes(visits, extension_votes, links)

    for voter in team_users:
        for device_id in links.get(voter, ()):
            if not devices[device_id].team:
                devices[device_id].team = True
                devices[device_id].team_reason = "votes of a team account came from it"

    outside = [v for v in visits if not devices[v.device].team]
    recent = [v for v in outside if v.started >= INSTALL_TYPE_SINCE]
    first_shown = parse_time(shown_rows[0]["created_at"]).date()
    last_shown = parse_time(shown_rows[-1]["created_at"]).date()

    team_reasons: dict[str, int] = defaultdict(int)
    for device in devices.values():
        if device.team:
            team_reasons[device.team_reason] += 1

    linked_votes = len(extension_votes) - sum(v["voter_id"] in unlinked for v in extension_votes)
    voters_by_kind = {
        "signed in": {v["voter_id"] for v in extension_votes if not v["is_anonymous"]},
        "anonymous": {v["voter_id"] for v in extension_votes if v["is_anonymous"]},
    }
    outside_devices = {v.device for v in outside}
    outside_voting_devices = {v.device for v in outside if v.voted_notes}
    report = [
        f"Window: notes_shown events from {first_shown} to {last_shown} (UTC).",
        "",
        f"Browsers outside the team that ever had notes shown: {len(outside_devices)}. "
        f"Of these, {len(outside_voting_devices)} voted at least once "
        f"({pct(len(outside_voting_devices) / len(outside_devices))}, Wilson 95% CI "
        f"{pct(wilson(len(outside_voting_devices), len(outside_devices))[0])} to "
        f"{pct(wilson(len(outside_voting_devices), len(outside_devices))[1])}).",
        "",
        "## Readers outside the team, whole window",
        table(breakdowns(outside, rng)),
        "",
        f"## Readers outside the team, since {INSTALL_TYPE_SINCE.date()} (every event carries its install type)",
        table(breakdowns(recent, rng)),
        "",
        "## Everyone, team included",
        table(breakdowns(visits, rng)),
        "",
        "## Data quality",
        f"- notes_shown events: {len(shown_rows)}, collapsed into {len(visits)} visits "
        f"(a reload within {SAME_VISIT_GAP} counts once).",
        f"- Browsers: {len(devices)}, of which team: {sum(d.team for d in devices.values())} "
        f"({', '.join(f'{n} {r}' for r, n in team_reasons.items())}).",
        f"- Extension votes: {len(extension_votes)} from {len({v['voter_id'] for v in extension_votes})} voters "
        f"({len(voters_by_kind['signed in'])} signed in, {len(voters_by_kind['anonymous'])} anonymous). "
        f"Votes whose voter was linked to a browser: {linked_votes}. Unlinked voters: {len(unlinked)}.",
        f"- Linked votes that fit no visit of their browser on that page: "
        f"{len(orphans) - (len(extension_votes) - linked_votes)}.",
        f"- Votes with no platform recorded (left out): {sum(v['platform'] == 'unknown' for v in all_votes)}; "
        f"website votes (left out): {sum(v['platform'] == 'web' for v in all_votes)}.",
        "",
        "### Unlinked voters",
        *[
            f"- {voter[:8]}: {sum(v['voter_id'] == voter for v in extension_votes)} votes on "
            f"{len({v['item_id'] for v in extension_votes if v['voter_id'] == voter})} page(s); candidate browsers: "
            f"{sum(devices[d].team for d in candidates)} team, {sum(not devices[d].team for d in candidates)} outside"
            for voter, candidates in unlinked.items()
        ],
        "",
        "### Votes per voting visit (outside the team)",
        *[
            f"- {n} note(s) voted on: {count} visits"
            for n, count in sorted(
                {n: sum(len(v.voted_notes) == n for v in outside) for n in {len(v.voted_notes) for v in outside if v.voted_notes}}.items()
            )
        ],
    ]
    text = "\n".join(report)
    (OUT_DIR / "results.md").write_text(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
