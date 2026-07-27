"""Interactive Plotly versions of the UMAP plots with note text on hover."""

import json
import textwrap
from pathlib import Path

import numpy as np
import plotly.graph_objects as go

DIR = Path(__file__).parent

notes = json.loads((DIR / "notes.json").read_text())
coords = np.load(DIR / "umap_coords.npy")
assert len(notes) == len(coords)


def hover_text(note):
    wrapped = "<br>".join(textwrap.wrap(note["note_text"], width=70))
    return (
        f"{wrapped}<br><br>"
        f"eval score: {note['evaluation_score']:.2f}<br>"
        f"outcome: {note['outcome']} | status: {note['cn_status']}<br>"
        f"tweet: {note['tweet_id']}"
    )


hovers = [hover_text(n) for n in notes]
eval_scores = [n["evaluation_score"] for n in notes]

AXIS_OFF = dict(visible=False)
LAYOUT = dict(
    plot_bgcolor="white",
    width=1200,
    height=900,
    xaxis=AXIS_OFF,
    yaxis=AXIS_OFF,
    hoverlabel=dict(font_size=12),
)

# Plot 1: all notes colored by eval score (red < 0 < blue, white at 0)
fig = go.Figure(
    go.Scattergl(
        x=coords[:, 0], y=coords[:, 1], mode="markers", text=hovers,
        hoverinfo="text",
        marker=dict(
            color=eval_scores, colorscale="RdBu", cmid=0, size=6,
            opacity=0.85, line=dict(width=0.3, color="grey"),
            colorbar=dict(title="eval score"),
        ),
    )
)
fig.update_layout(title=f"Simple-bot notes (sonnet search + gemini writer), n={len(notes)} — eval score", **LAYOUT)
fig.write_html(DIR / "plot1_eval_score.html", include_plotlyjs="cdn")
print(f"wrote {DIR / 'plot1_eval_score.html'}")

# Plot 2: submitted notes colored by CN status, unsubmitted as faint backdrop
STATUS_COLORS = {
    "CURRENTLY_RATED_HELPFUL": ("green", "helpful"),
    "CURRENTLY_RATED_NOT_HELPFUL": ("red", "unhelpful"),
    "NEEDS_MORE_RATINGS": ("grey", "needs more ratings"),
}
fig = go.Figure()
backdrop = [i for i, n in enumerate(notes) if not (n["submitted"] and n["cn_status"] in STATUS_COLORS)]
fig.add_trace(
    go.Scattergl(
        x=coords[backdrop, 0], y=coords[backdrop, 1], mode="markers",
        text=[hovers[i] for i in backdrop], hoverinfo="text",
        marker=dict(color="#e5e5e5", size=4), name="not submitted (backdrop)",
    )
)
for status, (color, label) in STATUS_COLORS.items():
    idx = [i for i, n in enumerate(notes) if n["submitted"] and n["cn_status"] == status]
    fig.add_trace(
        go.Scattergl(
            x=coords[idx, 0], y=coords[idx, 1], mode="markers",
            text=[hovers[i] for i in idx], hoverinfo="text",
            marker=dict(color=color, size=8, opacity=0.85, line=dict(width=0.3, color="black")),
            name=f"{label} ({len(idx)})",
        )
    )
n_submitted = sum(1 for n in notes if n["submitted"] and n["cn_status"] in STATUS_COLORS)
fig.update_layout(title=f"Submitted notes (n={n_submitted}) — CN status", **LAYOUT)
fig.write_html(DIR / "plot2_cn_status.html", include_plotlyjs="cdn")
print(f"wrote {DIR / 'plot2_cn_status.html'}")
