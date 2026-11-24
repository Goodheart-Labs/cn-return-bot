"""Replays the post list's order on production data (GOO-868, Jim's idea of
adding a post's own readers to its creator's rank).

Every real reservation of a feed post by one of our own notewriters is one
check the team could make at that moment. At each one, the replay builds the
list as it would have stood under a given order, and the check goes to that
order's top post instead of the one the notewriter really took. A post a
reader requested was checked at the same moment under every order, because
requests come first in all of them.

A checked post is judged by its later readers: the different readers who first
opened the page after its check ended and within HORIZON_HOURS. An order only
sees readers who opened the page before the moment it decides, and creator
scores from the daily refresh before that moment, so it cannot peek ahead.

Run from the repository root: uv run src/scripts_jim/2026_11_24_reader_count_ranking/replay.py
"""

import bisect
import collections
import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA = Path(__file__).parent / "data"

PRIORITY_RANK = 1000.0
PRIORITY_DAYS = 7
MIN_SCORE_TO_WALK = 1.0
MIN_VISITED_POSTS_TO_WALK = 2
MAX_REST_RANK = 0.99
IMAGINED_UNREAD_POSTS = 2
IMAGINED_AVERAGE_POSTS = 3
# Migration 183's daily caps, which #772 shares.
DEMAND_DAILY_CAP = {"text": 20, "youtube": 20}
LISTED_DEMAND_READERS = {"text": 2, "youtube": 2}
DEMAND_WINDOW = timedelta(days=7)
DEMAND_PASS = timedelta(minutes=5)
COUNTING_OUTCOMES = {"done", "skipped", None}


def parse_time(value: str | None) -> datetime | None:
    if value is None:
        return None
    text = value.replace(" ", "T")
    if text.endswith("+00"):
        text += ":00"
    return datetime.fromisoformat(text).astimezone(timezone.utc)


def parse_day(value: str | None):
    return None if value is None else datetime.fromisoformat(value[:10]).date()


def feed_kind(creator: str | None) -> str:
    if creator is None:
        return "none"
    if "youtube.com" in creator:
        return "youtube"
    if any(host in creator for host in ("lesswrong.com", "alignmentforum.org", "effectivealtruism.org")):
        return "lesswrong"
    return "substack"


@dataclass
class Post:
    id: str
    page: str
    kind: str  # "text" or "youtube", as migration 183 sorts them
    creator: str | None
    list_day: object  # the publication day, else the day it was added
    added_at: datetime
    demanded_at: datetime | None  # set by migration 183's queue
    from_demand_queue: bool  # the page entered the list only through migration 183
    checked_before: datetime | None  # a counting reservation before the replay
    reader_minutes: list = field(default_factory=list)  # first-visit times, sorted
    reader_prefix: list = field(default_factory=list)

    def readers_before(self, at: datetime) -> int:
        i = bisect.bisect_left(self.reader_minutes, at)
        return self.reader_prefix[i - 1] if i > 0 else 0

    def readers_between(self, start: datetime, end: datetime) -> int:
        return self.readers_before(end) - self.readers_before(start)


class CreatorRanks:
    """Each creator's list rank as cn-walk set it after each daily refresh."""

    def __init__(self, score_rows: list[dict], projects: list[dict]):
        by_cut = collections.defaultdict(dict)
        for row in score_rows:
            by_cut[parse_time(row["at"])][row["creator"]] = (row["visitors_per_post"], row["posts"])
        self.cuts = sorted(by_cut)
        self.scores = [by_cut[c] for c in self.cuts]
        self.averages = []
        for scores in self.scores:
            posts = sum(p for _, p in scores.values())
            self.averages.append(sum(v * p for v, p in scores.values()) / posts)
        self.priority_until = {p["creator"]: parse_time(p["priority_until"]) for p in projects if p["priority_until"]}
        self.cache = {}

    def creator_score(self, creator: str, cut: int) -> tuple[float, int]:
        vpp, posts = self.scores[cut].get(creator, (0.0, 0))
        average = self.averages[cut]
        score = (vpp * posts + IMAGINED_AVERAGE_POSTS * average) / (posts + IMAGINED_AVERAGE_POSTS + IMAGINED_UNREAD_POSTS)
        return score, posts

    def prioritized(self, creator: str, at: datetime) -> bool:
        # Only the last press is known, so a creator counts as holding
        # priority in the 7 days before its priority_until.
        until = self.priority_until.get(creator)
        return until is not None and until - timedelta(days=PRIORITY_DAYS) <= at < until

    def rank(self, creator: str | None, at: datetime) -> float:
        """listRank in src/walk/feedSchedule.ts."""
        if creator is None:
            return 0.0
        cut = bisect.bisect_right(self.cuts, at) - 1
        key = (creator, cut, self.prioritized(creator, at))
        if key not in self.cache:
            score, posts = self.creator_score(creator, cut)
            if key[2]:
                value = PRIORITY_RANK + score
            elif score >= MIN_SCORE_TO_WALK and posts >= MIN_VISITED_POSTS_TO_WALK:
                value = score
            elif feed_kind(creator) in ("substack", "lesswrong"):
                value = min(score, MAX_REST_RANK)
            else:
                value = 0.0  # videos of creators below the bar are not listed with a rank
            self.cache[key] = value
        return self.cache[key]


def load_posts() -> list[Post]:
    items = json.load(open(DATA / "items.json"))
    slots = json.load(open(DATA / "slots.json"))
    readers = collections.defaultdict(list)
    for row in json.load(open(DATA / "first_visits.json")):
        readers[row["page"]].append((parse_time(row["minute"]), row["readers"]))
    first_counting = {}
    for s in slots:
        if s["outcome"] in COUNTING_OUTCOMES:
            at = parse_time(s["started_at"])
            first_counting[s["item_id"]] = min(at, first_counting.get(s["item_id"], at))
    posts = []
    for i in items:
        if not i["has_text"] or i["flagged"] or (i["source"] == "youtube" and not i["has_cues"]):
            continue
        added = parse_time(i["created_at"])
        demanded = parse_time(i["demanded_at"])
        post = Post(
            id=i["id"],
            page=i["page"],
            kind="youtube" if i["source"] == "youtube" else "text",
            creator=i["creator"],
            list_day=parse_day(i["published_at"]) or added.date(),
            added_at=added,
            demanded_at=demanded,
            from_demand_queue=demanded is not None and abs((added - demanded).total_seconds()) < 120,
            checked_before=first_counting.get(i["id"]),
        )
        minutes = sorted(readers.get(i["page"], []))
        post.reader_minutes = [m for m, _ in minutes]
        total = 0
        for _, n in minutes:
            total += n
            post.reader_prefix.append(total)
        posts.append(post)
    return posts


@dataclass
class Order:
    """One way to order the list. Without a reader_term it is today's order."""

    name: str
    reader_term: object = None  # function of the post and the moment, or None
    demand_bump: bool = True  # migration 183's pages rank like a priority creator's
    keep_demand_queue: bool = True  # migration 183's pages are on the list at all
    listed_demand: bool = False  # #772: a waiting post moves up at its 2nd reader


def all_readers(weight):
    return lambda p, at: weight * p.readers_before(at)


def recent_readers(weight, hours):
    return lambda p, at: weight * p.readers_between(at - timedelta(hours=hours), at)


ORDERS = [
    Order("today"),
    Order("today + #772", listed_demand=True),
    Order("+0.1 per reader", reader_term=all_readers(0.1), demand_bump=False),
    Order("+0.25 per reader", reader_term=all_readers(0.25), demand_bump=False),
    Order("+0.5 per reader", reader_term=all_readers(0.5), demand_bump=False),
    Order("+1 per reader", reader_term=all_readers(1.0), demand_bump=False),
    Order("+2 per reader", reader_term=all_readers(2.0), demand_bump=False),
    Order("+log2(1 + readers)", reader_term=lambda p, at: math.log2(1 + p.readers_before(at)), demand_bump=False),
    Order("readers first", reader_term=all_readers(100.0), demand_bump=False),
    Order("+1 per reader of the last 24 h", reader_term=recent_readers(1.0, 24), demand_bump=False),
    Order("+1 per reader of the last 6 h", reader_term=recent_readers(1.0, 6), demand_bump=False),
    Order("+1 per reader, no demand queue", reader_term=all_readers(1.0), demand_bump=False, keep_demand_queue=False),
]


@dataclass
class Check:
    post: Post
    at: datetime
    visible_at: datetime
    later_readers: int
    readers_before: int
    hours_after_added: float


def replay(order: Order, posts: list[Post], slots: list[dict], ranks: CreatorRanks, start: datetime, end: datetime,
           window_days: int, horizon: timedelta) -> list[Check]:
    by_id = {p.id: p for p in posts}
    candidates = [p for p in posts if order.keep_demand_queue or not p.from_demand_queue]
    checked = {p.id for p in candidates if p.checked_before is not None and p.checked_before < start}
    moved_up_at = {}  # #772: when a waiting post was moved up
    demand_log = collections.deque()  # (time, kind) of every page 183 or #772 took
    for p in posts:
        if p.from_demand_queue and p.demanded_at and p.demanded_at < start:
            demand_log.append((p.demanded_at, p.kind))
    next_demand_pass = start
    checks = []

    def demanded_at(p: Post):
        if p.demanded_at is not None and order.keep_demand_queue:
            return p.demanded_at
        return moved_up_at.get(p.id)

    def run_demand_passes(until: datetime):
        nonlocal next_demand_pass
        while next_demand_pass <= until:
            at = next_demand_pass
            next_demand_pass += DEMAND_PASS
            for p in posts:  # migration 183's own pages count against the cap as they come in
                if p.from_demand_queue and p.demanded_at and at - DEMAND_PASS < p.demanded_at <= at:
                    demand_log.append((p.demanded_at, p.kind))
            while demand_log and demand_log[0][0] < at - timedelta(days=1):
                demand_log.popleft()
            if not order.listed_demand:
                continue
            used = collections.Counter(kind for _, kind in demand_log)
            waiting = [p for p in candidates
                       if p.id not in checked and p.added_at <= at and demanded_at(p) is None
                       and listed(p, at)]
            # The readers of the last 7 days; first visits stand in for any visit.
            waiting = [(p.readers_between(at - DEMAND_WINDOW, at), p) for p in waiting]
            waiting.sort(key=lambda x: (-x[0], x[1].page))
            for readers, p in waiting:
                if readers < LISTED_DEMAND_READERS[p.kind] or used[p.kind] >= DEMAND_DAILY_CAP[p.kind]:
                    continue
                moved_up_at[p.id] = at
                used[p.kind] += 1
                demand_log.append((at, p.kind))

    def list_day(p: Post):
        d = demanded_at(p)
        return d.date() if d is not None else p.list_day

    def listed(p: Post, at: datetime) -> bool:
        return list_day(p) >= at.date() - timedelta(days=window_days)

    def key(p: Post, at: datetime):
        rank = ranks.rank(p.creator, at)
        if demanded_at(p) is not None and (order.demand_bump or p.id in moved_up_at):
            rank = PRIORITY_RANK + math.fmod(rank, PRIORITY_RANK)
        if order.reader_term is not None:
            rank += order.reader_term(p, at)
        return (-rank, -list_day(p).toordinal(), p.id)

    for s in slots:
        at = parse_time(s["started_at"])
        if at < start or at >= end or s["outcome"] not in COUNTING_OUTCOMES:
            continue
        run_demand_passes(at)
        visible = parse_time(s["ended_at"]) or at
        if s["requested"]:
            post = by_id.get(s["item_id"])
            if post is None or post.id in checked:
                continue
        else:
            listable = [p for p in candidates if p.id not in checked and p.added_at <= at and listed(p, at)]
            if not listable:
                continue
            post = min(listable, key=lambda p: key(p, at))
        checked.add(post.id)
        checks.append(Check(post, at, visible, post.readers_between(visible, visible + horizon),
                            post.readers_before(at), (at - post.added_at).total_seconds() / 3600))
    return checks


def actual_checks(posts, slots, start, end, horizon) -> list[Check]:
    by_id = {p.id: p for p in posts}
    seen, checks = set(), []
    for s in slots:
        at = parse_time(s["started_at"])
        if at < start or at >= end or s["outcome"] not in COUNTING_OUTCOMES or s["item_id"] in seen:
            continue
        seen.add(s["item_id"])
        p = by_id.get(s["item_id"])
        if p is None:
            continue
        visible = parse_time(s["ended_at"]) or at
        checks.append(Check(p, at, visible, p.readers_between(visible, visible + horizon), p.readers_before(at),
                            (at - p.added_at).total_seconds() / 3600))
    return checks


def summarize(name: str, checks: list[Check], days: float, baseline: set | None = None) -> dict:
    later = [c.later_readers for c in checks]
    top_page = max(later) if later else 0
    ids = {c.post.id for c in checks}
    return {
        "order": name,
        "checks": len(checks),
        "later_readers": sum(later),
        "later_per_day": sum(later) / days,
        "later_per_day_without_top": (sum(later) - top_page) / days,
        "checks_with_later_readers": sum(1 for x in later if x > 0),
        "readers_before_check": sum(c.readers_before for c in checks),
        "median_hours_waiting": sorted(c.hours_after_added for c in checks)[len(checks) // 2] if checks else None,
        "videos": sum(1 for c in checks if c.post.kind == "youtube"),
        "same_posts_as_today": len(ids & baseline) if baseline is not None else None,
    }


def main():
    posts = load_posts()
    slots = sorted(json.load(open(DATA / "slots.json")), key=lambda s: s["started_at"])
    ranks = CreatorRanks(json.load(open(DATA / "creator_scores.json")), json.load(open(DATA / "projects.json")))
    runs = [
        # cn-walk listed every known creator's posts from 2026-11-19 (GOO-791).
        ("24 h horizon, 2026-11-19 08:00 to 11-23 00:00", datetime(2026, 11, 19, 8, tzinfo=timezone.utc),
         datetime(2026, 11, 23, tzinfo=timezone.utc), timedelta(hours=24)),
        ("48 h horizon, 2026-11-19 08:00 to 11-22 00:00", datetime(2026, 11, 19, 8, tzinfo=timezone.utc),
         datetime(2026, 11, 22, tzinfo=timezone.utc), timedelta(hours=48)),
    ]
    results = []
    for label, start, end, horizon in runs:
        days = (end - start).total_seconds() / 86400
        real = actual_checks(posts, slots, start, end, horizon)
        for window_days in (14, 1):
            print(f"\n== {label}, list window {window_days} day(s) ==")
            rows = [summarize("what really happened", real, days)]
            today_ids = None
            for order in ORDERS:
                checks = replay(order, posts, slots, ranks, start, end, window_days, horizon)
                if today_ids is None:
                    today_ids = {c.post.id for c in checks}
                    rows[0]["same_posts_as_today"] = len({c.post.id for c in real} & today_ids)
                rows.append(summarize(order.name, checks, days, today_ids))
            for r in rows:
                print(f"  {r['order']:34} checks {r['checks']:4}  later readers {r['later_readers']:4} "
                      f"({r['later_per_day']:5.1f}/day, {r['later_per_day_without_top']:5.1f} without top page)  "
                      f"posts with any {r['checks_with_later_readers']:3}  readers before {r['readers_before_check']:4}  "
                      f"videos {r['videos']:3}  median wait {r['median_hours_waiting']:.1f} h  same as today {r['same_posts_as_today']}")
            results.append({"run": label, "window_days": window_days, "rows": rows})
    json.dump(results, open(DATA / "results.json", "w"), indent=1, default=str)


if __name__ == "__main__":
    main()
