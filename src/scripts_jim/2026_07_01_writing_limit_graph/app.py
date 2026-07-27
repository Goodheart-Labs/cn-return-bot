"""
Interactive writing-limit graph (Plotly + Dash).

We don't persist the writing_limit value over time (pipeline_state is a single
overwritten key), so the line is a faithful *proxy*: the trailing-window count of
submitted notes — exactly the quantity X's daily cap counts against
(SupabaseLogger.countRecentSubmissions). Default window is 24h, the real cap
window (writingLimit.ts WINDOW_HOURS).

Red diamonds mark every run where we ACTUALLY hit the cap: X rejected a
submission with its daily-limit error and the rest of that run's queue was
recorded as outcome_reason='daily_limit_reached'. Handy fact: on a hit,
recordDailyLimitHit sets writing_limit = trailing-24h submission count, so at the
24h setting a diamond sits right at the cap X enforced that day. Its hover
reports that enforced cap and how many notes were skipped.

Run:  uv run src/scripts_jim/2026_07_01_writing_limit_graph/app.py
      (fetch_data.py must have been run first to produce data.json)
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from dash import Dash, dcc, html, Input, Output

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / "data.json").read_text())

HOUR_NS = 3_600_000_000_000
CAP_WINDOW_HOURS = 24            # X's real cap window
HIT_CLUSTER_GAP = pd.Timedelta("5min")  # runs are 15min apart; merge within-run rows only

# --- submissions: sorted DatetimeIndex + int64-ns array for searchsorted ---
# Force ns resolution: pandas parses these as datetime64[us], so asi8 would be
# microseconds and the HOUR_NS math below would be off by 1000x.
subs = pd.DatetimeIndex(
    pd.to_datetime(DATA["submissions"], utc=True, format="ISO8601")
).sort_values().as_unit("ns")
sub_ns = subs.asi8
first_sub, last_sub = subs[0], subs[-1]

# --- limit hits: cluster the skipped-candidate rows into distinct hit runs ---
hit_rows = pd.DataFrame(DATA["limit_hits"])
hit_rows["created_at"] = pd.to_datetime(hit_rows["created_at"], utc=True, format="ISO8601")
hit_rows = hit_rows.sort_values("created_at").reset_index(drop=True)
cluster_id = (hit_rows["created_at"].diff() > HIT_CLUSTER_GAP).cumsum()
hits = (hit_rows.groupby(cluster_id)
        .agg(time=("created_at", "min"), skipped=("created_at", "size"))
        .reset_index(drop=True))


def trailing_count(at_ns: np.ndarray, window_hours: int) -> np.ndarray:
    """# of submissions in (t - window, t] for each t in at_ns."""
    window_ns = window_hours * HOUR_NS
    upper = np.searchsorted(sub_ns, at_ns, side="right")
    lower = np.searchsorted(sub_ns, at_ns - window_ns, side="right")
    return upper - lower


def iso(times) -> list[str]:
    """DatetimeIndex/Series -> ISO strings. Pandas Timestamps aren't JSON-
    serializable (static image export fails); xaxis type='date' keeps time scaling."""
    return pd.DatetimeIndex(times).strftime("%Y-%m-%dT%H:%M:%S%z").tolist()


def add_hit_traces(fig: go.Figure, visible_hits: pd.DataFrame, window_hours: int) -> None:
    """On-curve diamond for every run that hit the cap."""
    hit_ns = pd.DatetimeIndex(visible_hits["time"]).as_unit("ns").asi8
    enforced_cap = trailing_count(hit_ns, CAP_WINDOW_HOURS)   # what X capped us at
    marker_y = trailing_count(hit_ns, window_hours)           # sit on the current line

    fig.add_trace(go.Scatter(
        x=iso(visible_hits["time"]), y=marker_y, mode="markers", name="Daily limit hit",
        marker=dict(color="#dc2626", size=10, symbol="diamond", line=dict(color="white", width=1)),
        customdata=np.stack([enforced_cap, visible_hits["skipped"]], axis=-1),
        hovertemplate="<b>Daily limit hit</b><br>%{x|%b %d %H:%M}"
                      "<br>Enforced cap ≈ %{customdata[0]} notes/24h"
                      "<br>%{customdata[1]} note(s) skipped this run<extra></extra>",
    ))


def build_figure(window_hours: int, start_date: pd.Timestamp) -> go.Figure:
    grid = pd.date_range(start_date.floor("h"), last_sub.ceil("h"), freq="1h", tz="UTC").as_unit("ns")
    line = trailing_count(grid.asi8, window_hours)

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=iso(grid), y=line, mode="lines", name=f"Submissions in trailing {window_hours}h",
        line=dict(color="#2563eb", width=1.5, shape="hv"),
        fill="tozeroy", fillcolor="rgba(37,99,235,0.08)",
        hovertemplate="%{x|%b %d %H:%M}<br>%{y} notes in trailing "
                      + f"{window_hours}h<extra></extra>",
    ))

    visible_hits = hits[hits["time"] >= start_date]
    if not visible_hits.empty:
        add_hit_traces(fig, visible_hits, window_hours)

    fig.update_layout(
        template="plotly_white",
        title=f"Writing-limit usage — notes submitted in trailing {window_hours}h",
        xaxis=dict(type="date"),
        yaxis_title=f"Notes submitted (trailing {window_hours}h)",
        hovermode="x unified", legend=dict(orientation="h", y=1.08, x=0),
        margin=dict(t=70, r=20, b=40, l=60), height=560,
    )
    return fig


RANGE_OPTIONS = {
    "All time": first_sub,
    "Since first limit hit (Apr 2026)": hits["time"].iloc[0] - pd.Timedelta("3d"),
    "Last 90 days": last_sub - pd.Timedelta("90d"),
}

app = Dash(__name__)
app.layout = html.Div(
    style={"maxWidth": "1100px", "margin": "24px auto", "fontFamily": "-apple-system, sans-serif"},
    children=[
        html.H2("Community Notes — Writing Limit Over Time"),
        html.P(
            "Blue line: notes submitted in the trailing window — the quantity X's daily "
            "cap counts against. Red diamonds: runs where we actually hit the cap (X rejected "
            "a submission with its daily-limit error). On a hit, the enforced cap equals the "
            "trailing-24h count, so at the 24h setting a diamond sits right at the cap.",
            style={"color": "#555", "fontSize": "0.9em", "lineHeight": "1.5"},
        ),
        html.Div(
            style={"display": "flex", "gap": "40px", "marginBottom": "8px"},
            children=[
                html.Div([
                    html.Label("Trailing window", style={"fontWeight": 600, "fontSize": "0.85em"}),
                    dcc.RadioItems(
                        id="window",
                        options=[{"label": f" {h}h", "value": h} for h in (12, 24, 48)],
                        value=24, inline=True,
                    ),
                ]),
                html.Div([
                    html.Label("Time range", style={"fontWeight": 600, "fontSize": "0.85em"}),
                    dcc.RadioItems(
                        id="range",
                        options=[{"label": f" {k}", "value": k} for k in RANGE_OPTIONS],
                        value="Since first limit hit (Apr 2026)", inline=True,
                    ),
                ]),
            ],
        ),
        dcc.Graph(id="graph"),
        html.P(
            f"{len(subs):,} submissions · {len(hits)} distinct limit-hit runs "
            f"({int(hits['skipped'].sum())} notes skipped) · "
            f"{first_sub:%Y-%m-%d} → {last_sub:%Y-%m-%d}",
            style={"color": "#999", "fontSize": "0.8em", "textAlign": "right"},
        ),
    ],
)


@app.callback(Output("graph", "figure"), Input("window", "value"), Input("range", "value"))
def update(window_hours, range_key):
    return build_figure(window_hours, RANGE_OPTIONS[range_key])


if __name__ == "__main__":
    print("Writing-limit graph → http://127.0.0.1:8055")
    app.run(debug=False, port=8055)
