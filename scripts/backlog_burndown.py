#!/usr/bin/env python3
"""Backlog burndown for Nathan's daily note review.

Answers "am I getting through the backlog?" by plotting the number of UNREVIEWED
notes over time, per category (rated-helpful / rated-not-helpful / underwater) —
the three pills Nathan reviews on Jim's Note Review Dashboard.

A note is "reviewed" when it has a `review_dashboard_annotations` row with
seen=true; that row's `updated_at` is the review timestamp (exact). A note's
entry date is `notes.first_seen_at` (fallback `submitted_at`).

    backlog(day, cat) = (notes in cat entered <= day)
                        - (notes in cat reviewed <= day)

CAVEAT (baked into the chart): category is each note's CURRENT cn_status applied
backward through all of history — Supabase keeps no per-day status snapshots, so
a note now "underwater" is treated as underwater since it first appeared. That
makes the reconstructed line approximate. To fix this going forward, every run
appends today's EXACT unreviewed counts to tmp/backlog_snapshots.csv; once enough
days accumulate, that file is the ground-truth series.

Run: source cn-return-bot/.env, then `python3 scripts/backlog_burndown.py`.
Outputs tmp/backlog_burndown.html (+ tmp/backlog_snapshots.csv) and prints paths.
"""
import os, sys, json, csv, urllib.request, datetime as dt
from collections import Counter, defaultdict

BASE = os.environ.get("SUPABASE_URL", "").rstrip("/") + "/rest/v1/"
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
if not KEY or "supabase" not in BASE:
    sys.exit("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY — `set -a && source .env`.")

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(HERE, "tmp")
HTML_PATH = os.path.join(OUT_DIR, "backlog_burndown.html")
CSV_PATH = os.path.join(OUT_DIR, "backlog_snapshots.csv")

# The three pills Nathan reviews, in draw order. Colors mirror the dashboard.
CATS = [
    ("underwater",     "Underwater",        "#6366f1"),  # indigo, matches pill
    ("rated_helpful",  "Rated helpful",     "#16a34a"),  # green
    ("rated_unhelpful","Rated not-helpful", "#dc2626"),  # red
]
CAT_KEYS = [c[0] for c in CATS]


def fetch_all(table, select, extra="", order="note_id.asc"):
    rows, step, off = [], 1000, 0
    while True:
        path = f"{table}?select={select}{extra}&order={order}&limit={step}&offset={off}"
        req = urllib.request.Request(BASE + path,
                                     headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
        d = json.load(urllib.request.urlopen(req))
        rows += d
        if len(d) < step:
            return rows
        off += step


def classify(notes, pub_by_id, lost_ids):
    """Mirror src/review-dashboard/src/lib/data.ts cnStatusToFailureType +
    isUnderwaterNote (public-dump counts first, scraped fallback; underwater =
    not_helpful > helpful)."""
    def resolve(nid, h, n):
        p = pub_by_id.get(nid)
        if p and (p.get("helpful_count") is not None or p.get("not_helpful_count") is not None):
            return (p.get("helpful_count") or 0), (p.get("not_helpful_count") or 0)
        return (h or 0), (n or 0)
    out = {}
    for note in notes:
        nid, s = note["note_id"], note["cn_status"]
        if s == "CURRENTLY_RATED_HELPFUL":
            out[nid] = "rated_helpful"
        elif s == "CURRENTLY_RATED_NOT_HELPFUL":
            out[nid] = "rated_unhelpful"
        elif nid in lost_ids:
            out[nid] = "lost_to_competitor"
        elif s == "NEEDS_MORE_RATINGS":
            h, n = resolve(nid, note["helpful_count"], note["not_helpful_count"])
            out[nid] = "underwater" if n > h else "needs_more_ratings"
        else:
            out[nid] = "uncategorized"
    return out


def day(iso):
    return iso[:10] if iso else None


def build_series(notes, cat_by_id, reviewed_day_by_id):
    """Per-category daily remaining-backlog series over [start, today]."""
    entry = {}   # nid -> entry date str
    for note in notes:
        entry[note["note_id"]] = day(note["first_seen_at"] or note["submitted_at"])

    # Daily deltas: +1 to backlog on entry day, -1 on review day (only for notes
    # currently in one of the three tracked categories).
    add = defaultdict(lambda: Counter())   # date -> cat -> count entering
    rem = defaultdict(lambda: Counter())   # date -> cat -> count reviewed
    review_dates, entry_dates = [], []
    for nid, cat in cat_by_id.items():
        if cat not in CAT_KEYS:
            continue
        e = entry.get(nid)
        if not e:
            continue
        add[e][cat] += 1
        entry_dates.append(e)
        r = reviewed_day_by_id.get(nid)
        if r:
            # Guard: a review logged before the note's own entry date would make
            # backlog dip early; clamp review no earlier than entry.
            r = max(r, e)
            rem[r][cat] += 1
            review_dates.append(r)

    today = dt.date.today()
    # Start the x-axis a touch before reviewing began, so the "burn" era is the focus.
    first_review = min(review_dates) if review_dates else min(entry_dates)
    start = dt.date.fromisoformat(first_review) - dt.timedelta(days=3)

    dates, series = [], {c: [] for c in CAT_KEYS}
    running = Counter()
    d = start
    # Seed running backlog with everything entered/reviewed strictly before start.
    for date_str, c in add.items():
        if dt.date.fromisoformat(date_str) < start:
            running.update(c)
    for date_str, c in rem.items():
        if dt.date.fromisoformat(date_str) < start:
            for k, v in c.items():
                running[k] -= v
    while d <= today:
        ds = d.isoformat()
        running.update(add.get(ds, {}))
        for k, v in rem.get(ds, {}).items():
            running[k] -= v
        dates.append(ds)
        for c in CAT_KEYS:
            series[c].append(running[c])
        d += dt.timedelta(days=1)
    return dates, series


def current_snapshot(cat_by_id, reviewed_seen_ids):
    """Exact unreviewed counts right now, per tracked category."""
    total = Counter()
    reviewed = Counter()
    for nid, cat in cat_by_id.items():
        if cat not in CAT_KEYS:
            continue
        total[cat] += 1
        if nid in reviewed_seen_ids:
            reviewed[cat] += 1
    return {c: {"total": total[c], "reviewed": reviewed[c], "remaining": total[c] - reviewed[c]}
            for c in CAT_KEYS}


def append_snapshot(snap):
    today = dt.date.today().isoformat()
    existing = []
    if os.path.exists(CSV_PATH):
        with open(CSV_PATH) as f:
            existing = [r for r in csv.reader(f)][1:]
    existing = [r for r in existing if r and r[0] != today]  # overwrite today
    for c in CAT_KEYS:
        s = snap[c]
        existing.append([today, c, s["total"], s["reviewed"], s["remaining"]])
    existing.sort(key=lambda r: (r[0], r[1]))
    with open(CSV_PATH, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "category", "total", "reviewed", "remaining"])
        w.writerows(existing)


# ── SVG chart ────────────────────────────────────────────────────────────────
def svg_chart(dates, series, w=920, h=440, pad_l=54, pad_r=140, pad_t=28, pad_b=52):
    n = len(dates)
    plot_w, plot_h = w - pad_l - pad_r, h - pad_t - pad_b
    all_vals = [v for c in CAT_KEYS for v in series[c]]
    ymax = max(all_vals + [1])
    ymax = int((ymax // 100 + 1) * 100) if ymax > 100 else int((ymax // 10 + 1) * 10)

    def X(i):
        return pad_l + (plot_w * i / max(n - 1, 1))
    def Y(v):
        return pad_t + plot_h - (plot_h * v / ymax)

    parts = [f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" '
             f'font-family="ui-sans-serif,system-ui,-apple-system,sans-serif">']
    # y gridlines + labels
    steps = 5
    for k in range(steps + 1):
        v = ymax * k / steps
        y = Y(v)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{pad_l+plot_w}" y2="{y:.1f}" '
                     f'stroke="#e5e7eb" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l-8}" y="{y+4:.1f}" text-anchor="end" '
                     f'font-size="11" fill="#6b7280">{int(v)}</text>')
    # x ticks: roughly weekly
    tick_every = max(1, n // 12)
    for i in range(0, n, tick_every):
        x = X(i)
        parts.append(f'<line x1="{x:.1f}" y1="{pad_t+plot_h}" x2="{x:.1f}" y2="{pad_t+plot_h+5}" '
                     f'stroke="#9ca3af" stroke-width="1"/>')
        parts.append(f'<text x="{x:.1f}" y="{pad_t+plot_h+20}" text-anchor="middle" '
                     f'font-size="10" fill="#6b7280">{dates[i][5:]}</text>')
    # series lines
    for key, label, color in CATS:
        pts = " ".join(f"{X(i):.1f},{Y(v):.1f}" for i, v in enumerate(series[key]))
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{color}" '
                     f'stroke-width="2.2" stroke-linejoin="round"/>')
        last = series[key][-1]
        ly = Y(last)
        parts.append(f'<circle cx="{X(n-1):.1f}" cy="{ly:.1f}" r="3" fill="{color}"/>')
        parts.append(f'<text x="{X(n-1)+8:.1f}" y="{ly+4:.1f}" font-size="11.5" '
                     f'fill="{color}" font-weight="600">{label} ({last})</text>')
    parts.append('</svg>')
    return "".join(parts)


def main():
    print("Fetching notes / ratings / annotations from Supabase…", file=sys.stderr)
    notes = fetch_all("notes", "note_id,cn_status,first_seen_at,submitted_at,helpful_count,not_helpful_count")
    pub = fetch_all("note_ratings_from_public_dump", "note_id,helpful_count,not_helpful_count")
    comp = fetch_all("competing_notes", "our_note_id",
                     "&current_status=eq.CURRENTLY_RATED_HELPFUL&our_note_id=not.is.null",
                     order="our_note_id.asc")
    ann = fetch_all("review_dashboard_annotations", "target_id,seen,updated_at",
                    "&source=eq.production", order="updated_at.asc")

    pub_by_id = {r["note_id"]: r for r in pub}
    lost_ids = {c["our_note_id"] for c in comp}
    cat_by_id = classify(notes, pub_by_id, lost_ids)

    reviewed_day_by_id, reviewed_seen_ids = {}, set()
    for a in ann:
        if a.get("seen"):
            reviewed_seen_ids.add(a["target_id"])
            reviewed_day_by_id[a["target_id"]] = day(a["updated_at"])

    dates, series = build_series(notes, cat_by_id, reviewed_day_by_id)
    snap = current_snapshot(cat_by_id, reviewed_seen_ids)
    append_snapshot(snap)

    total_remaining = sum(snap[c]["remaining"] for c in CAT_KEYS)
    total_reviewed = sum(snap[c]["reviewed"] for c in CAT_KEYS)
    generated = dt.date.today().isoformat()

    cards = "".join(
        f'<div class="card" style="border-top:3px solid {color}">'
        f'<div class="lbl">{label}</div>'
        f'<div class="big">{snap[key]["remaining"]}</div>'
        f'<div class="sub">left &middot; {snap[key]["reviewed"]}/{snap[key]["total"]} reviewed</div></div>'
        for key, label, color in CATS
    )

    html = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Note-review backlog burndown</title>
<style>
  body {{ font-family: ui-sans-serif,system-ui,-apple-system,sans-serif; color:#111827;
         margin:0; padding:32px 40px; background:#fafafa; }}
  h1 {{ font-size:20px; margin:0 0 2px; }}
  .meta {{ color:#6b7280; font-size:13px; margin-bottom:20px; }}
  .cards {{ display:flex; gap:14px; margin-bottom:8px; flex-wrap:wrap; }}
  .card {{ background:#fff; border:1px solid #e5e7eb; border-radius:10px;
           padding:12px 16px; min-width:150px; box-shadow:0 1px 2px rgba(0,0,0,.04); }}
  .card .lbl {{ font-size:12px; color:#6b7280; }}
  .card .big {{ font-size:30px; font-weight:700; line-height:1.1; }}
  .card .sub {{ font-size:11.5px; color:#9ca3af; }}
  .chartwrap {{ background:#fff; border:1px solid #e5e7eb; border-radius:10px;
               padding:12px; overflow-x:auto; margin-top:12px; }}
  .caveat {{ color:#6b7280; font-size:12px; margin-top:16px; max-width:860px; line-height:1.5; }}
  code {{ background:#f3f4f6; padding:1px 5px; border-radius:4px; font-size:11.5px; }}
</style></head><body>
<h1>Note-review backlog &mdash; am I getting through it?</h1>
<div class="meta">Unreviewed notes remaining over time, per pill on Jim&rsquo;s dashboard.
  Generated {generated}. &nbsp;<b>{total_remaining}</b> left across the three
  categories ({total_reviewed} reviewed all-time).</div>
<div class="cards">{cards}</div>
<div class="chartwrap">{svg_chart(dates, series)}</div>
<div class="caveat">
  <b>How to read it.</b> Each line is the count of notes in that category you
  haven&rsquo;t marked <i>seen</i> yet. Line falling = you&rsquo;re reviewing faster than
  new notes arrive (catching up); line rising = falling behind.<br><br>
  <b>Caveat.</b> Category = each note&rsquo;s <i>current</i> CN status applied backward
  through history (Supabase keeps no daily status snapshots), so past values are
  approximate &mdash; a note now underwater is counted as underwater since it first
  appeared. Review timestamps are exact. Each run appends today&rsquo;s exact counts to
  <code>tmp/backlog_snapshots.csv</code>; that file becomes the ground-truth series
  as days accumulate.
</div>
</body></html>"""

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(HTML_PATH, "w") as f:
        f.write(html)
    print(f"chart:   {HTML_PATH}")
    print(f"snapshot:{CSV_PATH}")
    for key, label, _ in CATS:
        s = snap[key]
        print(f"  {label:18} {s['remaining']:4} left  ({s['reviewed']}/{s['total']} reviewed)")


if __name__ == "__main__":
    main()
