#!/usr/bin/env python3
"""Daily note-review quota + trendline — "how many do I review today?"

Turns Nathan's note-review backlog into one task-shaped number: review N today
(a weekday amount) and you stay on the glide path to 0 unseen by the deadline.
Also writes an HTML trendline (actual pile vs the target line to zero) and, if
run with no --no-open, opens it.

Pile = UNSEEN notes across the three pills Nathan reviews on Jim's dashboard:
Rated-helpful, Rated-not-helpful, Underwater. "Unseen" = no review_dashboard_
annotations row with seen=true. Category + underwater logic mirror the dashboard
exactly (src/review-dashboard/src/lib/data.ts, tuned 2026-07-14):
  underwater = NEEDS_MORE_RATINGS, >=5 total ratings, (helpful+0.5*somewhat)/total < 0.2
Rating counts resolve public-dump-first, scraped-fallback (resolveRatingCounts).

Model — self-correcting weekday glide path with inflow:
  weekdays_left = Mon-Fri between today and DEADLINE (today included if a weekday)
  future_inflow = recent notes-arriving/day * calendar days left   (weekend
                  arrivals pile up for weekday review)
  quota/weekday = ceil((pile + future_inflow) / weekdays_left)
  left_today    = quota - reviewed_today
Recomputes from LIVE data each run, so it self-corrects: get ahead → tomorrow's
number drops; fall behind or inflow rises → it climbs to hold the deadline.

Run: `set -a && source .env && set +a`, then `python3 scripts/note_quota.py`.
"""
import os, sys, json, math, webbrowser, urllib.request, datetime as dt
from collections import Counter
from statistics import median

# ── Config (edit to move the goalposts) ──────────────────────────────────────
START_DATE = dt.date(2026, 7, 1)    # Nathan started rating ~2 weeks ago; the 100-day clock starts here
HORIZON    = 100                    # days to reach 0 unseen
DEADLINE   = START_DATE + dt.timedelta(days=HORIZON)   # 2026-10-09
INFLOW_WINDOW = 5                   # full days used for the robust recent-inflow estimate (median)

UNDERWATER_MIN_RATINGS = 5
UNDERWATER_RATIO_THRESHOLD = 0.2

BASE = os.environ.get("SUPABASE_URL", "").rstrip("/") + "/rest/v1/"
KEY  = os.environ.get("SUPABASE_SERVICE_KEY", "")
if not KEY or "supabase" not in BASE:
    sys.exit("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY — `set -a && source .env && set +a`.")

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PATH = os.path.join(HERE, "tmp", "note_quota.html")

CAT_KEYS  = ["underwater", "rated_helpful", "rated_unhelpful"]
CAT_LABEL = {"underwater": "Underwater", "rated_helpful": "Rated helpful",
             "rated_unhelpful": "Rated not-helpful"}
CAT_COLOR = {"underwater": "#6366f1", "rated_helpful": "#16a34a", "rated_unhelpful": "#dc2626"}


def fetch(table, select, extra="", order="note_id.asc"):
    rows, step, off = [], 1000, 0
    while True:
        path = f"{table}?select={select}{extra}&order={order}&limit={step}&offset={off}"
        req = urllib.request.Request(BASE + path,
                                     headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
        batch = json.load(urllib.request.urlopen(req))
        rows += batch
        if len(batch) < step:
            return rows
        off += step


def resolve_counts(pub, fh, fn):
    """resolveRatingCounts: public-dump value if present (not null), else scraped."""
    h = pub.get("helpful_count") if pub and pub.get("helpful_count") is not None else fh
    n = pub.get("not_helpful_count") if pub and pub.get("not_helpful_count") is not None else fn
    return (h or 0), (n or 0)


def is_underwater(pub, fh, fn):
    h, n = resolve_counts(pub, fh, fn)
    sw = (pub.get("somewhat_helpful_count") if pub else 0) or 0
    total = h + sw + n
    if total < UNDERWATER_MIN_RATINGS:
        return False
    return (h + 0.5 * sw) / total < UNDERWATER_RATIO_THRESHOLD


def classify(note, pub_by_id, lost_ids):
    nid, s = note["note_id"], note["cn_status"]
    if s == "CURRENTLY_RATED_HELPFUL":
        return "rated_helpful"
    if s == "CURRENTLY_RATED_NOT_HELPFUL":
        return "rated_unhelpful"
    if nid in lost_ids:
        return "lost_to_competitor"
    if s == "NEEDS_MORE_RATINGS":
        return "underwater" if is_underwater(pub_by_id.get(nid), note["helpful_count"],
                                             note["not_helpful_count"]) else "needs_more_ratings"
    return "uncategorized"


def weekdays_between(a, b):
    """Count Mon-Fri in [a, b)."""
    return sum(1 for k in range((b - a).days) if (a + dt.timedelta(days=k)).weekday() < 5)


def local_date(iso):
    """updated_at is stored UTC (…+00:00); "today" must be Nathan's LOCAL day,
    or an evening-Pacific review (already tomorrow in UTC) is missed. Convert the
    aware timestamp to the system timezone before taking the date."""
    try:
        return dt.datetime.fromisoformat(iso).astimezone().date().isoformat()
    except Exception:
        return (iso or "")[:10]


def main():
    open_chart = "--no-open" not in sys.argv
    notes = fetch("notes", "note_id,cn_status,first_seen_at,submitted_at,helpful_count,not_helpful_count")
    pub   = fetch("note_ratings_from_public_dump", "note_id,helpful_count,somewhat_helpful_count,not_helpful_count")
    comp  = fetch("competing_notes", "our_note_id",
                  "&current_status=eq.CURRENTLY_RATED_HELPFUL&our_note_id=not.is.null",
                  order="our_note_id.asc")
    ann   = fetch("review_dashboard_annotations", "target_id,seen,updated_at",
                  "&source=eq.production", order="updated_at.asc")

    pub_by_id = {r["note_id"]: r for r in pub}
    lost_ids  = {c["our_note_id"] for c in comp}
    seen_day  = {a["target_id"]: local_date(a["updated_at"]) for a in ann if a.get("seen")}

    # Tracked notes only: category + entry date.
    entry, catof = {}, {}
    for note in notes:
        c = classify(note, pub_by_id, lost_ids)
        if c in CAT_KEYS:
            catof[note["note_id"]] = c
            entry[note["note_id"]] = (note["first_seen_at"] or note["submitted_at"] or "")[:10]

    today = dt.date.today()
    tstr = today.isoformat()
    reviewed_today = sum(1 for nid, d in seen_day.items() if d == tstr and nid in catof)

    # Current unseen pile, per category.
    remaining = Counter()
    for nid, c in catof.items():
        if nid not in seen_day:
            remaining[c] += 1
    pile = sum(remaining.values())

    # ── Reconstruct unseen-on-day (current classification applied backward;
    # underwater is approximate before a note reached its ratings, but it's the
    # best we have without daily snapshots). Delta method for the whole series.
    delta = Counter()
    for nid, e in entry.items():
        if not e:
            continue
        delta[e] += 1
        sd = seen_day.get(nid)
        if sd:
            delta[max(sd, e)] -= 1

    def series(a, b):
        """Daily unseen from a to b inclusive, seeded with everything before a."""
        run = sum(v for d, v in delta.items() if d < a.isoformat())
        out, d = [], a
        while d <= b:
            run += delta.get(d.isoformat(), 0)
            out.append((d, run))
            d += dt.timedelta(days=1)
        return out

    actual = series(START_DATE, today)
    P0 = actual[0][1]                       # unseen on START_DATE

    total_wd   = weekdays_between(START_DATE, DEADLINE)
    elapsed_wd = weekdays_between(START_DATE, today)
    target_today = P0 * (total_wd - elapsed_wd) / total_wd if total_wd else 0
    above = pile - target_today

    # ── Inflow: new tracked notes entering per calendar day, robust recent rate.
    entered_by_day = Counter(e for e in entry.values() if e)
    recent = [entered_by_day[(today - dt.timedelta(days=k)).isoformat()]
              for k in range(1, INFLOW_WINDOW + 1)]
    inflow = median(recent) if recent else 0

    cal_days_left = (DEADLINE - today).days
    weekdays_left = max(weekdays_between(today, DEADLINE), 1)
    future_inflow = inflow * cal_days_left
    quota = math.ceil((pile + future_inflow) / weekdays_left)

    is_weekday = today.weekday() < 5
    left = max(0, quota - reviewed_today) if is_weekday else 0
    fill = round(min(1.0, reviewed_today / quota) * 20) if quota else 20
    bar = "█" * fill + "░" * (20 - fill)

    # ── Terminal ─────────────────────────────────────────────────────────────
    print()
    print(f"  ┌─ NOTE-REVIEW QUOTA · {tstr} ({today.strftime('%a')}) ─────────")
    print(f"  │  Pile: {pile:,} unseen   →   0 by {DEADLINE.isoformat()}")
    print(f"  │    " + "   ".join(f"{CAT_LABEL[k]} {remaining[k]}" for k in CAT_KEYS))
    print(f"  │")
    print(f"  │  Trend: should be ~{target_today:.0f} today · you're at {pile:,}")
    updown = "ABOVE (behind)" if above > 0 else "below (ahead)"
    print(f"  │    → {abs(above):.0f} {updown} trend ({above/max(target_today,1)*100:+.0f}%)")
    print(f"  │")
    print(f"  │  {weekdays_left} weekdays left · ~{inflow:.0f} notes/day arriving (~{future_inflow:.0f} more)")
    print(f"  │  Per-weekday quota: {quota}   = ({pile:,} + {future_inflow:.0f}) ÷ {weekdays_left}")
    print(f"  │  [{bar}]  {reviewed_today} done today")
    print(f"  │")
    if is_weekday:
        print(f"  │  ▶ {left} more to review today")
    else:
        print(f"  │  ▶ weekend — weekday target is {quota}")
    print(f"  └────────────────────────────────────────────────────")
    print()

    write_chart(actual, START_DATE, DEADLINE, P0, today, pile, target_today, quota, left,
                remaining, reviewed_today, inflow)
    print(f"chart: {HTML_PATH}")
    if open_chart:
        webbrowser.open("file://" + HTML_PATH)


# ── Trendline chart ──────────────────────────────────────────────────────────
def write_chart(actual, start, deadline, P0, today, pile, target_today, quota, left,
                remaining, reviewed_today, inflow):
    W, H = 960, 420
    PL, PR, PT, PB = 52, 24, 24, 40
    pw, ph = W - PL - PR, H - PT - PB
    span = (deadline - start).days
    ymax = int((max(P0, pile) // 200 + 1) * 200)

    def X(d):  # date -> px
        return PL + pw * ((d - start).days) / span
    def Y(v):
        return PT + ph - ph * v / ymax

    p = [f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" '
         f'font-family="ui-sans-serif,system-ui,-apple-system,sans-serif">']
    # gridlines + y labels
    for k in range(6):
        v = ymax * k / 5
        y = Y(v)
        p.append(f'<line x1="{PL}" y1="{y:.1f}" x2="{PL+pw}" y2="{y:.1f}" stroke="#eceef1" stroke-width="1"/>')
        p.append(f'<text x="{PL-8}" y="{y+4:.1f}" text-anchor="end" font-size="11" fill="#98a2b3">{int(v)}</text>')
    # month ticks
    d = start.replace(day=1)
    while d <= deadline:
        if d >= start:
            x = X(d)
            p.append(f'<line x1="{x:.1f}" y1="{PT+ph}" x2="{x:.1f}" y2="{PT+ph+5}" stroke="#cbd2d9"/>')
            p.append(f'<text x="{x:.1f}" y="{PT+ph+18}" text-anchor="middle" font-size="10" fill="#98a2b3">{d.strftime("%b %-d")}</text>')
        d = (d.replace(day=28) + dt.timedelta(days=7)).replace(day=1)
    # target glide path (dashed grey): today's-pile is NOT the anchor; the anchor
    # is P0 at start so the line shows the plan you signed up for.
    p.append(f'<line x1="{X(start):.1f}" y1="{Y(P0):.1f}" x2="{X(deadline):.1f}" y2="{Y(0):.1f}" '
             f'stroke="#9aa5b1" stroke-width="2" stroke-dasharray="6 5"/>')
    p.append(f'<text x="{X(deadline):.1f}" y="{Y(0)-8:.1f}" text-anchor="end" font-size="11" fill="#9aa5b1">target → 0 by {deadline.strftime("%b %-d")}</text>')
    # actual line (solid dark) + area
    pts = " ".join(f"{X(dd):.1f},{Y(v):.1f}" for dd, v in actual)
    p.append(f'<polyline points="{pts}" fill="none" stroke="#111827" stroke-width="2.4" stroke-linejoin="round"/>')
    # today marker + gap
    xt, ya, yt = X(today), Y(pile), Y(target_today)
    p.append(f'<line x1="{xt:.1f}" y1="{ya:.1f}" x2="{xt:.1f}" y2="{yt:.1f}" stroke="#f59e0b" stroke-width="2"/>')
    p.append(f'<circle cx="{xt:.1f}" cy="{ya:.1f}" r="4" fill="#111827"/>')
    p.append(f'<circle cx="{xt:.1f}" cy="{yt:.1f}" r="3" fill="#9aa5b1"/>')
    gap = pile - target_today
    p.append(f'<text x="{xt+7:.1f}" y="{(ya+yt)/2:.1f}" font-size="11.5" fill="#b45309" font-weight="600">+{gap:.0f} above trend</text>')
    p.append('</svg>')
    svg = "".join(p)

    cards = "".join(
        f'<div class="c" style="border-top:3px solid {CAT_COLOR[k]}"><div class="l">{CAT_LABEL[k]}</div>'
        f'<div class="b">{remaining[k]}</div><div class="s">unseen</div></div>' for k in CAT_KEYS)

    html = f"""<!doctype html><meta charset="utf-8"><title>Note-review glide path</title>
<style>
 body{{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#111827;margin:0;padding:28px 34px;background:#fafafa}}
 h1{{font-size:19px;margin:0 0 2px}} .m{{color:#6b7280;font-size:13px;margin-bottom:18px}}
 .hero{{display:flex;gap:14px;align-items:stretch;flex-wrap:wrap;margin-bottom:14px}}
 .big{{background:#111827;color:#fff;border-radius:12px;padding:14px 20px;min-width:150px}}
 .big .n{{font-size:40px;font-weight:800;line-height:1}} .big .k{{font-size:12px;opacity:.8;margin-top:3px}}
 .c{{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 15px;min-width:120px}}
 .c .l{{font-size:12px;color:#6b7280}} .c .b{{font-size:26px;font-weight:700}} .c .s{{font-size:11px;color:#9ca3af}}
 .chart{{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px;overflow-x:auto}}
 .note{{color:#6b7280;font-size:12px;margin-top:14px;max-width:900px;line-height:1.55}}
</style>
<h1>Note review — path to zero</h1>
<div class="m">Unseen pile across your three pills vs the glide path to 0 by {deadline.isoformat()}. Generated {today.isoformat()}.</div>
<div class="hero">
  <div class="big"><div class="n">{left}</div><div class="k">to review today &middot; {reviewed_today} done &middot; {quota}/weekday</div></div>
  <div class="c" style="border-top:3px solid #f59e0b"><div class="l">Above trend</div><div class="b">+{pile-target_today:.0f}</div><div class="s">should be ~{target_today:.0f}, at {pile}</div></div>
  {cards}
</div>
<div class="chart">{svg}</div>
<div class="note"><b>Reading it.</b> Black = your actual unseen pile since {start.strftime('%b %-d')};
dashed grey = the plan (start pile {P0:.0f} &rarr; 0 by {deadline.strftime('%b %-d')}); amber = today's gap.
Line rising means new notes (~{inflow:.0f}/day) outrun your reviews. The weekday number self-corrects each run:
get ahead and it falls, slip and it climbs to hold the date. Underwater uses the dashboard's current rule
(&ge;5 ratings, weighted score &lt; 0.2); reconstructed underwater history is approximate.</div>
"""
    os.makedirs(os.path.dirname(HTML_PATH), exist_ok=True)
    with open(HTML_PATH, "w") as f:
        f.write(html)


if __name__ == "__main__":
    main()
