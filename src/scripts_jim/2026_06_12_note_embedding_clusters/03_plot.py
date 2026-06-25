"""UMAP projection of note embeddings, colored by eval score and CN status."""

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import umap
from matplotlib.colors import TwoSlopeNorm
from matplotlib.lines import Line2D

DIR = Path(__file__).parent
UMAP_SEED = 42

notes = json.loads((DIR / "notes.json").read_text())
embeddings = np.load(DIR / "embeddings.npy")
assert len(notes) == len(embeddings), (len(notes), len(embeddings))

print(f"running UMAP on {embeddings.shape}")
reducer = umap.UMAP(n_neighbors=15, min_dist=0.1, metric="cosine", random_state=UMAP_SEED)
coords = reducer.fit_transform(embeddings)
np.save(DIR / "umap_coords.npy", coords)

eval_scores = np.array([n["evaluation_score"] for n in notes])

# Plot 1: all notes, diverging red (negative) -> white (0) -> blue (positive)
fig, ax = plt.subplots(figsize=(12, 10))
norm = TwoSlopeNorm(vmin=eval_scores.min(), vcenter=0, vmax=eval_scores.max())
sc = ax.scatter(
    coords[:, 0], coords[:, 1], c=eval_scores, cmap="RdBu", norm=norm,
    s=14, alpha=0.85, edgecolors="grey", linewidths=0.2,
)
fig.colorbar(sc, ax=ax, label="eval score")
ax.set_title(f"Simple-bot notes (sonnet search + gemini writer), n={len(notes)} — colored by eval score")
ax.set_xticks([])
ax.set_yticks([])
fig.tight_layout()
fig.savefig(DIR / "plot1_eval_score.png", dpi=200)
print(f"wrote {DIR / 'plot1_eval_score.png'}")

# Plot 2: submitted notes only, colored by CN status
STATUS_COLORS = {
    "CURRENTLY_RATED_HELPFUL": ("green", "helpful"),
    "CURRENTLY_RATED_NOT_HELPFUL": ("red", "unhelpful"),
    "NEEDS_MORE_RATINGS": ("grey", "needs more ratings"),
}
submitted_mask = np.array([n["submitted"] and n["cn_status"] in STATUS_COLORS for n in notes])
sub_coords = coords[submitted_mask]
sub_status = [n["cn_status"] for n, m in zip(notes, submitted_mask) if m]

fig, ax = plt.subplots(figsize=(12, 10))
ax.scatter(coords[:, 0], coords[:, 1], c="#eeeeee", s=8, zorder=1)  # unsubmitted backdrop
for status, (color, label) in STATUS_COLORS.items():
    mask = np.array([s == status for s in sub_status])
    ax.scatter(
        sub_coords[mask, 0], sub_coords[mask, 1], c=color, s=22, alpha=0.85,
        edgecolors="black", linewidths=0.2,
        zorder=3 if status != "NEEDS_MORE_RATINGS" else 2,
        label=f"{label} ({mask.sum()})",
    )
ax.legend(handles=ax.get_legend_handles_labels()[0] + [
    Line2D([], [], marker="o", linestyle="", color="#eeeeee", label="not submitted (backdrop)")
])
ax.set_title(f"Submitted notes (n={len(sub_coords)}) — colored by CN status")
ax.set_xticks([])
ax.set_yticks([])
fig.tight_layout()
fig.savefig(DIR / "plot2_cn_status.png", dpi=200)
print(f"wrote {DIR / 'plot2_cn_status.png'}")
